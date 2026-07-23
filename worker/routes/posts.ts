import { Hono } from "hono";
import type { Env } from "../index";
import { requireAdmin } from "../lib/supabase";
import { loadProject, projectAuth } from "../lib/project";
import { makeCompanionRunner } from "../lib/companion";
import {
  fetchPostFull,
  pushPost,
  createTerm,
  uploadMedia,
  listMedia,
} from "../lib/wordpress";
import { replaceSourceLinks } from "../lib/links";

export const posts = new Hono<{ Bindings: Env }>();

/** Fetch a single WordPress post's full content + Yoast fields (for editing). */
posts.get("/api/projects/:id/posts/:wpId", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const project = await loadProject(sb, c.req.param("id"));
  if (!project) return c.json({ error: "project not found" }, 404);
  try {
    const auth = await projectAuth(c.env, project);
    const runner = makeCompanionRunner(sb, project.id);
    const full = await fetchPostFull(auth, Number(c.req.param("wpId")), runner);
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
    status?: string;
    categories: { id: number; name: string }[];
    tags: { id: number; name: string }[];
    featured_media?: number | null;
    featured_image_url?: string | null;
    focus_keyword?: string;
    seo_title?: string;
    meta_description?: string;
  }>();

  const allowed = ["draft", "publish", "pending", "private"];
  const status = allowed.includes(body.status ?? "") ? body.status! : "draft";

  try {
    const auth = await projectAuth(c.env, project);
    const runner = makeCompanionRunner(sb, projectId);
    const { id: wpId, link } = await pushPost(auth, {
      wpId: body.wpId,
      title: body.title,
      content_html: body.content_html,
      status,
      categories: body.categories.map((t) => t.id),
      tags: body.tags.map((t) => t.id),
      featured_media: body.featured_media,
      focus_keyword: body.focus_keyword,
      seo_title: body.seo_title,
      meta_description: body.meta_description,
    }, runner);

    const row: Record<string, unknown> = {
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
      wp_status: status,
      local_status: "pushed",
      published_at: status === "publish" ? new Date().toISOString() : null,
      pushed_at: new Date().toISOString(),
    };
    // Capture the WP permalink the push returned (used for view-on-site / preview).
    if (link) row.link = link;
    // Update the existing local row (by primary key) when the editor already
    // saved one — otherwise a second row would be created (the duplicate bug).
    // Fall back to conflict-on-wp_post_id for rows that arrived via sync.
    if (body.postId) {
      row.id = body.postId;
      await sb.from("posts").upsert(row);
    } else {
      await sb.from("posts").upsert(row, { onConflict: "project_id,wp_post_id" });
    }
    await sb.from("projects").update({ last_post_at: new Date().toISOString() }).eq("id", projectId);

    // Keep the internal-links inventory current for this post. Best-effort —
    // link bookkeeping must never fail a push.
    try {
      await replaceSourceLinks(
        sb,
        projectId,
        project.site_url,
        "post",
        wpId,
        body.title,
        link,
        body.content_html
      );
    } catch {
      // ignore
    }

    return c.json({ ok: true, wpId, status, link });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "push failed" }, 500);
  }
});

/** Lists images from the WordPress media library (for inserting into post body). */
posts.get("/api/projects/:id/media-list", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const project = await loadProject(sb, c.req.param("id"));
  if (!project) return c.json({ error: "project not found" }, 404);
  const page = Math.max(1, Number(c.req.query("page") ?? "1"));
  try {
    const auth = await projectAuth(c.env, project);
    const runner = makeCompanionRunner(sb, project.id);
    const { items, totalPages } = await listMedia(auth, page, runner);
    return c.json({ ok: true, items, totalPages });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, 500);
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
    const runner = makeCompanionRunner(sb, projectId);
    const term = await createTerm(auth, taxonomy, name, runner);
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
    // Return both `id` and `mediaId` — the editor reads `mediaId` to set featured_media.
    return c.json({ ok: true, id: media.id, mediaId: media.id, url: media.url });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, 500);
  }
});
