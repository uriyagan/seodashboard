import { Hono } from "hono";
import type { Env } from "../index";
import { requireAdmin } from "../lib/supabase";
import { loadProject, projectAuth } from "../lib/project";
import {
  generateCategoryIdeas,
  generateIdeas,
  generateArticle,
  generateImage,
  assignCategoriesToTitles,
  type IdeaBrief,
  type IdeaResearch,
} from "../lib/gemini";
import { uploadMedia } from "../lib/wordpress";
import { accessToken, scQuery } from "./gsc";
import type { ProjectRow } from "../lib/project";
import {
  loadProducts,
  eligibleCategories,
  topProductsForCategory,
} from "../lib/products";
import type { SupabaseClient } from "@supabase/supabase-js";

export const ideas = new Hono<{ Bindings: Env }>();

/** Product-category names for a project (from synced link targets). */
async function categoryNames(
  sb: SupabaseClient,
  projectId: string
): Promise<Map<number, string>> {
  const { data } = await sb
    .from("link_targets")
    .select("wp_id, title")
    .eq("project_id", projectId)
    .eq("type", "product_cat");
  return new Map((data ?? []).map((t: { wp_id: number; title: string }) => [t.wp_id, t.title]));
}

/**
 * Fetches the project's real Search Console queries (last 90 days) for the SEO
 * research step. Returns undefined on any failure or when GSC isn't configured
 * — the caller then degrades to a qualitative estimate (never fake numbers).
 */
async function fetchGscQueries(
  env: Env,
  sb: SupabaseClient,
  project: ProjectRow
): Promise<IdeaResearch["gscQueries"]> {
  if (!project.gsc_property) return undefined;
  try {
    const at = await accessToken(env, sb);
    if (!at) return undefined;
    const end = new Date();
    const start = new Date(end.getTime() - 90 * 86_400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const body = await scQuery(at.token, project.gsc_property, {
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: ["query"],
      rowLimit: 100,
    });
    const rows = (body.rows ?? [])
      .map((r) => ({
        query: r.keys?.[0] ?? "",
        clicks: r.clicks,
        impressions: r.impressions,
        position: r.position,
      }))
      .filter((r) => r.query);
    if (!rows.length) return undefined;
    rows.sort((a, b) => b.impressions - a.impressions);
    return rows.slice(0, 50); // cap prompt size
  } catch {
    return undefined;
  }
}

/**
 * Product categories eligible for idea generation: those with at least 5
 * in-stock products (spec §1.6). Returns [{ id, name, count }].
 */
ideas.get("/api/projects/:id/idea-categories", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");
  const [products, names] = await Promise.all([
    loadProducts(sb, projectId),
    categoryNames(sb, projectId),
  ]);
  return c.json({ ok: true, categories: eligibleCategories(products, names, 5) });
});

/**
 * "Suggest new ideas" (spec §1) — each idea is tied to a product category and
 * gets up to 50 top products saved behind the scenes for content generation.
 * Body: { categoryIds?: number[] } — empty/omitted means all eligible categories.
 */
ideas.post("/api/projects/:id/ideas/generate", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");
  const project = await loadProject(sb, projectId);
  if (!project) return c.json({ error: "project not found" }, 404);

  const { categoryIds } = await c.req
    .json<{ categoryIds?: number[] }>()
    .catch(() => ({ categoryIds: undefined }));

  const [products, names, postsRes, ideasRes, gscQueries] = await Promise.all([
    loadProducts(sb, projectId),
    categoryNames(sb, projectId),
    sb
      .from("posts")
      .select("title, focus_keyword")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(100),
    // Dedup against ALL ideas ever (suggested, written, rejected) — not just
    // pending — so a rejected idea can't be re-suggested.
    sb
      .from("ideas")
      .select("title")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(200),
    fetchGscQueries(c.env, sb, project),
  ]);

  const existingTitles = (postsRes.data ?? []).map((p: { title: string }) => p.title).filter(Boolean);
  const research: IdeaResearch = {
    gscQueries,
    existingPosts: (postsRes.data ?? []).filter((p: { title: string }) => p.title),
    allIdeaTitles: (ideasRes.data ?? []).map((i: { title: string }) => i.title).filter(Boolean),
  };
  const evidence: IdeaBrief["seo_evidence_type"] = gscQueries ? "external-data" : "qualitative-estimate";
  const withEvidence = (brief: Omit<IdeaBrief, "seo_evidence_type">): IdeaBrief => ({
    ...brief,
    seo_evidence_type: evidence,
  });

  const allEligible = eligibleCategories(products, names, 5);
  let eligible = allEligible;
  if (categoryIds && categoryIds.length) {
    const wanted = new Set(categoryIds);
    eligible = allEligible.filter((cat) => wanted.has(cat.id));
  }

  // Non-ecommerce (brochure) site — no product categories at all: fall back to
  // general ideas from the existing content, with no category association.
  if (!allEligible.length) {
    try {
      const suggestions = await generateIdeas(c.env, project.content_prompt, research, 6);
      const rows = suggestions
        .filter((s) => s.title)
        .map((s) => ({
          project_id: projectId,
          title: s.title,
          status: "suggested",
          brief: withEvidence(s.brief),
        }));
      if (!rows.length) return c.json({ ok: true, ideas: [] });
      const { data, error } = await sb
        .from("ideas")
        .insert(rows)
        .select("id, title, status, created_at, product_category_name, brief");
      if (error) throw error;
      return c.json({ ok: true, ideas: data });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, 500);
    }
  }

  // Ecommerce site but the selected categories aren't eligible (e.g. out of stock).
  if (!eligible.length) {
    return c.json(
      { ok: false, error: "הקטגוריות שנבחרו אינן זמינות (פחות מ-5 מוצרים במלאי). בחר קטגוריות אחרות." },
      400
    );
  }

  const catalog = eligible.map((cat) => ({
    id: cat.id,
    name: cat.name,
    sampleProducts: topProductsForCategory(products, cat.id, 12),
  }));
  const eligibleIds = new Set(eligible.map((cat) => cat.id));

  try {
    const suggestions = await generateCategoryIdeas(
      c.env,
      project.content_prompt,
      catalog,
      research,
      6
    );

    const rows = suggestions
      .filter((s) => s.title && eligibleIds.has(s.category_id))
      .map((s) => ({
        project_id: projectId,
        title: s.title,
        status: "suggested",
        product_category_id: s.category_id,
        product_category_name: names.get(s.category_id) ?? null,
        product_names: topProductsForCategory(products, s.category_id, 50),
        brief: withEvidence(s.brief),
      }));
    if (!rows.length) return c.json({ ok: true, ideas: [] });

    const { data, error } = await sb
      .from("ideas")
      .insert(rows)
      .select("id, title, status, created_at, product_category_name, brief");
    if (error) throw error;
    return c.json({ ok: true, ideas: data });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, 500);
  }
});

/**
 * Backfill: match existing articles (without a category) to the most relevant
 * product category and save the association + top products (spec §1.2).
 */
ideas.post("/api/projects/:id/backfill-categories", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");

  const [products, names, postsRes] = await Promise.all([
    loadProducts(sb, projectId),
    categoryNames(sb, projectId),
    sb
      .from("posts")
      .select("id, title")
      .eq("project_id", projectId)
      .is("product_category_id", null),
  ]);

  const posts = (postsRes.data ?? []) as { id: string; title: string }[];
  const eligible = eligibleCategories(products, names, 5);
  if (!posts.length) return c.json({ ok: true, updated: 0 });
  if (!eligible.length) {
    return c.json({ ok: false, error: "אין קטגוריות מוצרים עם מספיק מוצרים במלאי." }, 400);
  }

  try {
    const assignments = await assignCategoriesToTitles(
      c.env,
      posts.map((p) => p.title),
      eligible
    );
    let updated = 0;
    await Promise.all(
      posts.map(async (post, i) => {
        const catId = assignments[i];
        if (!catId) return;
        await sb
          .from("posts")
          .update({
            product_category_id: catId,
            product_category_name: names.get(catId) ?? null,
            product_names: topProductsForCategory(products, catId, 50),
          })
          .eq("id", post.id);
        updated++;
      })
    );
    return c.json({ ok: true, updated });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, 500);
  }
});

/**
 * Write a full post from an idea: generate article (content_prompt + the idea's
 * product category & products) + featured image, upload it, create a local draft.
 */
ideas.post("/api/projects/:id/ideas/:ideaId/write", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");
  const ideaId = c.req.param("ideaId");
  const project = await loadProject(sb, projectId);
  if (!project) return c.json({ error: "project not found" }, 404);

  const { data: idea } = await sb
    .from("ideas")
    .select("id, title, product_category_id, product_category_name, product_names, brief")
    .eq("id", ideaId)
    .single();
  if (!idea) return c.json({ error: "idea not found" }, 404);

  try {
    // 1. Article — written around the idea's full content brief (when present)
    //    plus its product category & products.
    const article = await generateArticle(
      c.env,
      project.content_prompt,
      idea.title,
      project.keywords,
      {
        categoryName: idea.product_category_name ?? undefined,
        productNames: (idea.product_names as string[]) ?? [],
        brief: (idea.brief as IdeaBrief | null) ?? undefined,
      }
    );

    // 2. Featured image (best-effort).
    let featuredUrl: string | null = null;
    let featuredMedia: number | null = null;
    try {
      const img = await generateImage(c.env, project.image_prompt, `תמונה ראשית לפוסט: ${article.title}`);
      const auth = await projectAuth(c.env, project);
      const bin = atob(img.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ext = img.mimeType.includes("jpeg") ? "jpg" : "png";
      const media = await uploadMedia(auth, bytes, `ai-${Date.now()}.${ext}`, img.mimeType);
      featuredUrl = media.url;
      featuredMedia = media.id;
    } catch {
      /* image generation optional */
    }

    // 3. Create local draft post (carry the category association forward).
    const { data: post, error } = await sb
      .from("posts")
      .insert({
        project_id: projectId,
        title: article.title,
        content_html: article.content_html,
        focus_keyword: article.focus_keyword,
        seo_title: article.seo_title,
        meta_description: article.meta_description,
        featured_image_url: featuredUrl,
        source: "idea",
        local_status: "editing",
        wp_status: "draft",
        product_category_id: idea.product_category_id,
        product_category_name: idea.product_category_name,
        product_names: idea.product_names ?? [],
      })
      .select("id")
      .single();
    if (error) throw error;

    await sb.from("ideas").update({ status: "written", post_id: post!.id }).eq("id", ideaId);

    return c.json({ ok: true, postId: post!.id, featuredUrl, featuredMedia });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, 500);
  }
});
