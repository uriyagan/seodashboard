import { Hono } from "hono";
import type { Env } from "../index";
import { requireAdmin } from "../lib/supabase";
import { loadProject, projectAuth } from "../lib/project";
import {
  generateArticle,
  generateImage,
  suggestInternalLinks,
  pickCategoryForTitle,
} from "../lib/gemini";
import { uploadMedia } from "../lib/wordpress";
import { loadProducts, eligibleCategories, topProductsForCategory } from "../lib/products";

export const ai = new Hono<{ Bindings: Env }>();

/** Fetches a remote image and returns it as an inline base64 reference. */
async function urlToRef(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") || "image/jpeg";
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (const b of buf) bin += String.fromCharCode(b);
    return { base64: btoa(bin), mimeType };
  } catch {
    return null;
  }
}

/** In-stock products (name + image) for a category, to pick from when
 *  generating a featured image (spec §5.3). No category → all in-stock. */
ai.get("/api/projects/:id/category-products", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");
  const categoryId = Number(c.req.query("categoryId")) || null;

  const products = await loadProducts(sb, projectId);
  const list = products
    .filter((p) => p.stock_status === "instock" && p.image_url)
    .filter((p) => !categoryId || p.category_ids.includes(categoryId))
    .sort((a, b) => b.total_sales - a.total_sales)
    .slice(0, 60)
    .map((p) => ({ wp_id: p.wp_id, name: p.name, image_url: p.image_url }));
  return c.json({ ok: true, products: list });
});

/**
 * Generate a full article with Gemini. When no idea/category was supplied,
 * the post's title is first matched to the most relevant product category and
 * its top products, so the content stays catalog-relevant (spec §2.3).
 */
ai.post("/api/projects/:id/ai/write", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");
  const project = await loadProject(sb, projectId);
  if (!project) return c.json({ error: "project not found" }, 404);

  const { topic, categoryId } = await c.req.json<{ topic: string; categoryId?: number }>();
  if (!topic?.trim()) return c.json({ ok: false, error: "missing topic" }, 400);

  try {
    // Associate a product category (given, or picked from the title).
    const [products, catRows] = await Promise.all([
      loadProducts(sb, projectId),
      sb.from("link_targets").select("wp_id, title").eq("project_id", projectId).eq("type", "product_cat"),
    ]);
    const names = new Map(
      (catRows.data ?? []).map((t: { wp_id: number; title: string }) => [t.wp_id, t.title])
    );
    const eligible = eligibleCategories(products, names, 5);

    let catId: number | null = categoryId ?? null;
    if (!catId && eligible.length) {
      catId = await pickCategoryForTitle(c.env, topic.trim(), eligible);
    }
    const categoryName = catId ? names.get(catId) ?? null : null;
    const productNames = catId ? topProductsForCategory(products, catId, 50) : [];

    const article = await generateArticle(
      c.env,
      project.content_prompt,
      topic.trim(),
      project.keywords,
      { categoryName: categoryName ?? undefined, productNames }
    );
    return c.json({
      ok: true,
      article,
      category_id: catId,
      category_name: categoryName,
      product_names: productNames,
    });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "generate failed" }, 500);
  }
});

/**
 * AI internal-link suggestions: Gemini reads the post + the site's synced
 * destinations (pages, product categories/tags, other posts) and proposes
 * contextual links. Suggestions are validated so the anchor really appears in
 * the post and the target is a known URL.
 */
ai.post("/api/projects/:id/internal-links", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");

  const { content_html, title } = await c.req.json<{ content_html: string; title?: string }>();
  const plain = (content_html ?? "")
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " ") // skip already-linked text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const { data: targetRows } = await sb
    .from("link_targets")
    .select("type, title, url")
    .eq("project_id", projectId)
    .limit(500);
  const targets = (targetRows ?? []) as { type: string; title: string; url: string }[];
  const urlSet = new Set(targets.map((t) => t.url));

  try {
    const raw = await suggestInternalLinks(c.env, title ?? "", plain, targets);
    // Keep only anchors that appear verbatim in the post and known targets; dedupe.
    const seen = new Set<string>();
    const suggestions = raw.filter((s) => {
      const anchor = (s.anchor ?? "").trim();
      const key = anchor.toLowerCase();
      if (!anchor || anchor.length < 2 || seen.has(key)) return false;
      if (!urlSet.has(s.target_url) || !plain.includes(anchor)) return false;
      seen.add(key);
      return true;
    });
    return c.json({ ok: true, suggestions });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, 500);
  }
});

/**
 * Generate an image with Nano Banana 2 using the project's image_prompt
 * as the base + a specific instruction, then upload it to WordPress media.
 */
ai.post("/api/projects/:id/ai/image", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");
  const project = await loadProject(sb, projectId);
  if (!project) return c.json({ error: "project not found" }, 404);

  const { specific, role, upload, refImages, refImageUrls } = await c.req.json<{
    specific: string;
    role?: "featured" | "body";
    upload?: boolean;
    refImages?: { base64: string; mimeType: string }[];
    refImageUrls?: string[];
  }>();

  try {
    // Reference images: uploaded (base64) + picked product images (by URL).
    const refs = [...(refImages ?? [])];
    if (refImageUrls?.length) {
      const fetched = await Promise.all(refImageUrls.slice(0, 3).map((u) => urlToRef(u)));
      for (const f of fetched) if (f) refs.push(f);
    }
    const img = await generateImage(c.env, project.image_prompt, specific ?? "", refs);

    // Optionally upload to WordPress media (needed for a usable URL on the site).
    if (upload !== false) {
      const auth = await projectAuth(c.env, project);
      const bin = atob(img.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ext = img.mimeType.includes("jpeg") ? "jpg" : "png";
      const media = await uploadMedia(auth, bytes, `ai-${Date.now()}.${ext}`, img.mimeType);
      await sb.from("post_images").insert({
        project_id: projectId,
        role: role ?? "featured",
        prompt: specific ?? "",
        wp_media_id: media.id,
        wp_url: media.url,
      });
      return c.json({ ok: true, url: media.url, mediaId: media.id });
    }

    // Return inline base64 (preview only, not uploaded).
    return c.json({ ok: true, base64: img.base64, mimeType: img.mimeType });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "image failed" }, 500);
  }
});
