import { Hono } from "hono";
import type { Env } from "../index";
import { requireAdmin } from "../lib/supabase";
import { loadProject, projectAuth } from "../lib/project";
import { generateCategoryIdeas, generateArticle, generateImage } from "../lib/gemini";
import { uploadMedia } from "../lib/wordpress";
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

  const [products, names, postsRes, pendingRes] = await Promise.all([
    loadProducts(sb, projectId),
    categoryNames(sb, projectId),
    sb.from("posts").select("title").eq("project_id", projectId),
    sb.from("ideas").select("title").eq("project_id", projectId).eq("status", "suggested"),
  ]);

  let eligible = eligibleCategories(products, names, 5);
  if (categoryIds && categoryIds.length) {
    const wanted = new Set(categoryIds);
    eligible = eligible.filter((cat) => wanted.has(cat.id));
  }
  if (!eligible.length) {
    return c.json(
      { ok: false, error: "אין קטגוריות מוצרים עם מספיק מוצרים במלאי. סנכרן את האתר או בחר קטגוריות אחרות." },
      400
    );
  }

  const existingTitles = (postsRes.data ?? []).map((p: { title: string }) => p.title).filter(Boolean);
  const pendingTitles = (pendingRes.data ?? []).map((i: { title: string }) => i.title).filter(Boolean);

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
      existingTitles,
      pendingTitles,
      10
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
      }));
    if (!rows.length) return c.json({ ok: true, ideas: [] });

    const { data, error } = await sb
      .from("ideas")
      .insert(rows)
      .select("id, title, status, created_at, product_category_name");
    if (error) throw error;
    return c.json({ ok: true, ideas: data });
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
    .select("id, title, product_category_id, product_category_name, product_names")
    .eq("id", ideaId)
    .single();
  if (!idea) return c.json({ error: "idea not found" }, 404);

  try {
    // 1. Article — written around the idea's product category & products.
    const article = await generateArticle(
      c.env,
      project.content_prompt,
      idea.title,
      project.keywords,
      {
        categoryName: idea.product_category_name ?? undefined,
        productNames: (idea.product_names as string[]) ?? [],
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
