import { Hono } from "hono";
import type { Env } from "../index";
import { requireAdmin } from "../lib/supabase";
import { loadProject, projectAuth } from "../lib/project";
import { generateArticle, generateImage } from "../lib/gemini";
import { uploadMedia } from "../lib/wordpress";

export const ai = new Hono<{ Bindings: Env }>();

/** Generate a full article with Gemini using the project's content_prompt. */
ai.post("/api/projects/:id/ai/write", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const project = await loadProject(sb, c.req.param("id"));
  if (!project) return c.json({ error: "project not found" }, 404);

  const { topic } = await c.req.json<{ topic: string }>();
  if (!topic?.trim()) return c.json({ ok: false, error: "missing topic" }, 400);

  try {
    const article = await generateArticle(c.env, project.content_prompt, topic.trim());
    return c.json({ ok: true, article });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "generate failed" }, 500);
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

  const { specific, role, upload } = await c.req.json<{
    specific: string;
    role?: "featured" | "body";
    upload?: boolean;
  }>();

  try {
    const img = await generateImage(c.env, project.image_prompt, specific ?? "");

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
