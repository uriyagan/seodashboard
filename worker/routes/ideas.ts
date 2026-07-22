import { Hono } from "hono";
import type { Env } from "../index";
import { requireAdmin } from "../lib/supabase";
import { loadProject, projectAuth } from "../lib/project";
import { generateIdeas, generateArticle, generateImage } from "../lib/gemini";
import { uploadMedia } from "../lib/wordpress";

export const ideas = new Hono<{ Bindings: Env }>();

/**
 * "Suggest new ideas" — send all existing post titles to Gemini and get
 * back N fresh post-title ideas, stored in the ideas table.
 */
ideas.post("/api/projects/:id/ideas/generate", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");
  const project = await loadProject(sb, projectId);
  if (!project) return c.json({ error: "project not found" }, 404);

  // Existing titles (from the synced posts).
  const { data: existing } = await sb
    .from("posts")
    .select("title")
    .eq("project_id", projectId);
  const titles = (existing ?? []).map((p: { title: string }) => p.title).filter(Boolean);

  try {
    const suggestions = await generateIdeas(c.env, project.content_prompt, titles, 10);
    const rows = suggestions.map((title) => ({ project_id: projectId, title, status: "suggested" }));
    const { data, error } = await sb.from("ideas").insert(rows).select("id, title, status, created_at");
    if (error) throw error;
    return c.json({ ok: true, ideas: data });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, 500);
  }
});

/**
 * Write a full post from an idea: generate article (content_prompt) +
 * featured image (image_prompt), upload the image, create a local draft post.
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
    .select("id, title")
    .eq("id", ideaId)
    .single();
  if (!idea) return c.json({ error: "idea not found" }, 404);

  try {
    // 1. Article
    const article = await generateArticle(
      c.env,
      project.content_prompt,
      idea.title,
      project.keywords
    );

    // 2. Featured image (best-effort — don't fail the whole write if image fails)
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

    // 3. Create local draft post (not yet pushed to WP)
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
