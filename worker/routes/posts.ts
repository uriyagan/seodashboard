import { Hono } from "hono";
import type { Env } from "../index";
import { requireAdmin } from "../lib/supabase";
import { loadProject, projectAuth } from "../lib/project";
import {
  fetchPostFull,
  pushPost,
  createTerm,
  uploadMedia,
} from "../lib/wordpress";

export const posts = new Hono<{ Bindings: Env }>();

/** Fetch a single WordPress post's full content + Yoast fields (for editing). */
posts.get("/api/projects/:id/posts/:wpId", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const project = await loadProject(sb, c.req.param("id"));
  if (!project) return c.json({ error: "project not found" }, 404);
  try {
    const auth = await projectAuth(c.env, project);
    const full = await fetchPostFull(auth, Number(c.req.param("wpId")));
    return c.json({ ok: true, post: full });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, 500);
  }
});

/**
 * Push a post to WordPress as a draft (create or update), set Yoast fields,
 * then update the local posts row.
 */
posts.post("/api/projects/:id/posts/push", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");
  const project = await loadProject(sb, projectId);
  if (!project) return c.json({ error: "project not found" }, 404);

  const body = await c.req.json<{
    postId?: string; // local id (optional)
    wpId?: number | null;
    title: string;
    content_html: string;
    categories: { id: number; name: string }[];
    tags: { id: number; name: string }[];
    featured_media?: number | null;
    featured_image_url?: string | null;
    focus_keyword?: string;
    seo_title?: string;
    meta_description?: string;
  }>();

  try {
    const auth = await projectAuth(c.env, project);
    const wpId = await pushPost(auth, {
      wpId: body.wpId,
      title: body.title,
      content_html: body.content_html,
      categories: body.categories.map((t) => t.id),
      tags: body.tags.map((t) => t.id),
      featured_media: body.featured_media,
      focus_keyword: body.focus_keyword,
      seo_title: body.seo_title,
      meta_description: body.meta_description,
    });

    const row = {
      project_id: projectId,
      wp_post_id: wpId,
      title: body.title,
      content_html: body.content_html,
      focus_keyword: body.focus_keyword ?? "",
      seo_title: body.seo_title ?? "",
      meta_description: body.meta_description ?? "",
      featured_image_url: body.featured_image_url ?? null,
      categories: body.categories,
      tags: body.tags,
      wp_status: "draft",
      local_status: "pushed",
      pushed_at: new Date().toISOString(),
    };
    await sb.from("posts").upsert(row, { onConflict: "project_id,wp_post_id" });
    await sb.from("projects").update({ last_post_at: new Date().toISOString() }).eq("id", projectId);

    return c.json({ ok: true, wpId });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "push failed" }, 500);
  }
});

/** Create a new category or tag on WordPress + cache locally. */
posts.post("/api/projects/:id/terms", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");
  const project = await loadProject(sb, projectId);
  if (!project) return c.json({ error: "project not found" }, 404);

  const { taxonomy, name } = await c.req.json<{
    taxonomy: "categories" | "tags";
    name: string;
  }>();

  try {
    const auth = await projectAuth(c.env, project);
    const term = await createTerm(auth, taxonomy, name);
    await sb.from("wp_terms").upsert(
      {
        project_id: projectId,
        wp_term_id: term.id,
        taxonomy: taxonomy === "categories" ? "category" : "post_tag",
        name: term.name,
        slug: term.slug,
      },
      { onConflict: "project_id,taxonomy,wp_term_id" }
    );
    return c.json({ ok: true, term });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, 500);
  }
});

/** Upload a base64 image to the WordPress media library. */
posts.post("/api/projects/:id/media", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const project = await loadProject(sb, c.req.param("id"));
  if (!project) return c.json({ error: "project not found" }, 404);

  const { base64, mimeType, filename } = await c.req.json<{
    base64: string;
    mimeType: string;
    filename: string;
  }>();

  try {
    const auth = await projectAuth(c.env, project);
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const media = await uploadMedia(auth, bytes, filename || "image.png", mimeType || "image/png");
    return c.json({ ok: true, ...media });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, 500);
  }
});
