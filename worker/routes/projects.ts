import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../index";
import { requireAdmin } from "../lib/supabase";
import { encrypt, decrypt } from "../lib/crypto";
import {
  checkRestReachable,
  testConnection,
  detectYoast,
  fetchAllTerms,
  fetchAllPosts,
  type WpAuth,
} from "../lib/wordpress";
import { makeCompanionRunner, type CompanionRunner } from "../lib/companion";

export const projects = new Hono<{ Bindings: Env }>();

/** Decode a handful of common HTML entities in rendered titles. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "’")
    .replace(/&#8211;/g, "–")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** True when the error means the host firewall challenged us (not a real failure). */
function isFirewallBlock(err?: string): boolean {
  return /blocked by host firewall|blocked \(HTTP/i.test(err || "");
}

/** Step 1 — verify the WordPress REST API is reachable. */
projects.post("/api/projects/check-url", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const { url } = await c.req.json<{ url: string }>();
  if (!url) return c.json({ ok: false, error: "missing url" }, 400);
  const result = await checkRestReachable(url);
  // A firewalled site can't be reached directly — proceed via the companion later.
  if (!result.ok && isFirewallBlock(result.error)) {
    return c.json({ ok: true, firewalled: true });
  }
  return c.json(result);
});

/** Step 2 — verify credentials + detect Yoast. */
projects.post("/api/projects/test-connection", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<{ url: string; username: string; appPassword: string }>();
  const auth: WpAuth = {
    siteUrl: body.url,
    username: body.username,
    appPassword: body.appPassword,
  };
  const conn = await testConnection(auth);
  // Firewalled: credentials can't be verified directly; the companion will.
  if (!conn.ok && isFirewallBlock(conn.error)) {
    return c.json({ ok: true, firewalled: true });
  }
  if (!conn.ok) return c.json(conn);
  const yoast = await detectYoast(body.url);
  return c.json({ ...conn, yoast });
});

/** Shared: sync all posts + taxonomies from WordPress into the local DB. */
async function syncProject(
  sb: SupabaseClient,
  projectId: string,
  auth: WpAuth,
  runner?: CompanionRunner
): Promise<{ posts: number; categories: number; tags: number }> {
  // 1. Taxonomies
  const [categories, tags] = await Promise.all([
    fetchAllTerms(auth, "categories", runner),
    fetchAllTerms(auth, "tags", runner),
  ]);

  const termRows = [
    ...categories.map((t) => ({
      project_id: projectId,
      wp_term_id: t.id,
      taxonomy: "category",
      name: decodeEntities(t.name),
      slug: t.slug,
    })),
    ...tags.map((t) => ({
      project_id: projectId,
      wp_term_id: t.id,
      taxonomy: "post_tag",
      name: decodeEntities(t.name),
      slug: t.slug,
    })),
  ];
  if (termRows.length) {
    await sb.from("wp_terms").upsert(termRows, {
      onConflict: "project_id,taxonomy,wp_term_id",
    });
  }

  const catName = new Map(categories.map((t) => [t.id, decodeEntities(t.name)]));
  const tagName = new Map(tags.map((t) => [t.id, decodeEntities(t.name)]));

  // 2. Posts (metadata + titles only)
  const posts = await fetchAllPosts(auth, runner);
  let latest: string | null = null;
  const postRows = posts.map((p) => {
    if (p.date && (!latest || p.date > latest)) latest = p.date;
    return {
      project_id: projectId,
      wp_post_id: p.id,
      title: decodeEntities(p.title),
      wp_status: p.status,
      local_status: "pushed",
      source: "synced",
      categories: p.categories.map((id) => ({ id, name: catName.get(id) ?? "" })),
      tags: p.tags.map((id) => ({ id, name: tagName.get(id) ?? "" })),
      published_at: p.status === "publish" ? p.date : null,
      pushed_at: p.modified,
    };
  });
  if (postRows.length) {
    // content_html intentionally omitted → preserved on re-sync, default on insert.
    await sb.from("posts").upsert(postRows, { onConflict: "project_id,wp_post_id" });
  }

  await sb
    .from("projects")
    .update({ last_post_at: latest, yoast_ready: await detectYoast(auth.siteUrl, runner) })
    .eq("id", projectId);

  return { posts: posts.length, categories: categories.length, tags: tags.length };
}

/** Step 3 — create the project (encrypted creds) and run the initial sync. */
projects.post("/api/projects/connect", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  if (!c.env.ENCRYPTION_KEY) return c.json({ error: "server not configured" }, 500);

  const body = await c.req.json<{
    name: string;
    url: string;
    username: string;
    appPassword: string;
  }>();

  const auth: WpAuth = {
    siteUrl: body.url.replace(/\/+$/, ""),
    username: body.username,
    appPassword: body.appPassword,
  };

  // Re-verify before saving. A firewall block is not a hard failure — we'll
  // finish the connection through the companion snippet.
  const conn = await testConnection(auth);
  const firewalled = !conn.ok && isFirewallBlock(conn.error);
  if (!conn.ok && !firewalled) return c.json({ ok: false, error: conn.error }, 400);

  const encrypted = await encrypt(auth.appPassword, c.env.ENCRYPTION_KEY);

  const { data: project, error } = await sb
    .from("projects")
    .insert({
      name: body.name.trim(),
      site_url: auth.siteUrl,
      wp_username: auth.username,
      wp_app_password_encrypted: encrypted,
    })
    .select("id, companion_token")
    .single();
  if (error || !project) return c.json({ ok: false, error: error?.message }, 500);

  // Firewalled: skip the direct sync; the user installs the companion snippet
  // and then syncs. Return the token so the UI can render the snippet.
  if (firewalled) {
    return c.json({
      ok: true,
      projectId: project.id,
      firewalled: true,
      companionToken: (project as { companion_token: string }).companion_token,
    });
  }

  try {
    const counts = await syncProject(sb, project.id, auth);
    return c.json({ ok: true, projectId: project.id, ...counts });
  } catch (e) {
    return c.json({
      ok: true,
      projectId: project.id,
      warning: "הפרויקט נוצר אך הסנכרון נכשל — אפשר לסנכרן שוב",
      error: e instanceof Error ? e.message : "sync failed",
    });
  }
});

/** Re-sync an existing project using its stored credentials. */
projects.post("/api/projects/:id/sync", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const id = c.req.param("id");

  const { data: proj, error } = await sb
    .from("projects")
    .select("site_url, wp_username, wp_app_password_encrypted")
    .eq("id", id)
    .single();
  if (error || !proj) return c.json({ ok: false, error: "project not found" }, 404);
  if (!proj.wp_app_password_encrypted) {
    return c.json({ ok: false, error: "אין פרטי חיבור WordPress לפרויקט זה" }, 400);
  }

  const auth: WpAuth = {
    siteUrl: proj.site_url,
    username: proj.wp_username,
    appPassword: await decrypt(proj.wp_app_password_encrypted, c.env.ENCRYPTION_KEY!),
  };

  // Direct first; if the host firewall blocks us, the companion queue takes over.
  const runner = makeCompanionRunner(sb, id);
  try {
    const counts = await syncProject(sb, id, auth, runner);
    return c.json({ ok: true, ...counts });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "sync failed" }, 500);
  }
});
