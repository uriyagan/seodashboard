import { Hono } from "hono";
import type { Env } from "../index";
import { requireAdmin } from "../lib/supabase";
import { loadProject, projectAuth, relayFrom } from "../lib/project";
import { makeCompanionRunner } from "../lib/companion";
import { suggestInternalLinks, type LinkTargetInput } from "../lib/gemini";
import {
  fetchPostFull,
  fetchRenderedContent,
  fetchRawContent,
  fetchTermDescription,
  updateContent,
  updateTermDescription,
} from "../lib/wordpress";
import {
  applyAnchorLink,
  probeUrl,
  refreshLinksChunk,
  stripToPlainText,
  type RefreshCursor,
} from "../lib/links";

/**
 * Internal-links feature routes. Heavy operations (inventory refresh, broken
 * check, AI scan) are chunked: each call handles a small batch and returns a
 * cursor — the frontend loops until done. This keeps every request small
 * (no Worker wall-clock/subrequest risk) and yields natural progress UI.
 */
export const links = new Hono<{ Bindings: Env }>();

const trimUrl = (u: string) => u.replace(/\/+$/, "");

/** One chunk of the full-site link-inventory refresh. */
links.post("/api/projects/:id/links/refresh", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");
  const project = await loadProject(sb, projectId);
  if (!project) return c.json({ error: "project not found" }, 404);

  const { cursor } = await c.req.json<{ cursor?: RefreshCursor }>().catch(() => ({ cursor: undefined }));
  try {
    const auth = await projectAuth(c.env, project);
    const runner = makeCompanionRunner(sb, projectId);
    const processed = cursor ?? { phase: "posts" as const, page: 1 };
    const step = await refreshLinksChunk(sb, projectId, project.site_url, auth, cursor, runner);
    return c.json({
      ok: true,
      done: step.next.phase === "done",
      cursor: step.next,
      progress: {
        phase: processed.phase,
        page: processed.page,
        totalPages: step.totalPages,
        inserted: step.inserted,
      },
    });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "refresh failed" }, 500);
  }
});

/**
 * Broken-link check for a batch of URLs (≤15). The frontend computes the
 * distinct-URL worklist from site_links and chunks it — the server stays
 * stateless. URLs are verified to belong to the project's inventory so the
 * endpoint can't be used as a generic prober. Internal URLs probe through the
 * static-IP relay (a direct hit on a firewalled host returns the anti-bot
 * challenge page with a 2xx — a false "ok").
 */
links.post("/api/projects/:id/links/check", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");
  const project = await loadProject(sb, projectId);
  if (!project) return c.json({ error: "project not found" }, 404);

  const { urls } = await c.req.json<{ urls: string[] }>();
  if (!Array.isArray(urls) || urls.length === 0) return c.json({ ok: true, results: [] });
  const batch = urls.slice(0, 15);

  const { data: known } = await sb
    .from("site_links")
    .select("target_url, is_internal")
    .eq("project_id", projectId)
    .in("target_url", batch);
  const internalByUrl = new Map((known ?? []).map((r) => [r.target_url as string, Boolean(r.is_internal)]));

  const relay = relayFrom(c.env);
  const checks = batch
    .filter((u) => internalByUrl.has(u))
    .map(async (url) => {
      const probe = await probeUrl(url, internalByUrl.get(url) ? relay : undefined);
      return { url, ...probe };
    });
  const settled = await Promise.allSettled(checks);
  const results = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));

  if (results.length) {
    await sb.from("link_checks").upsert(
      results.map((r) => ({
        project_id: projectId,
        url: r.url,
        http_status: r.status,
        result: r.result,
        error: r.error ?? null,
        checked_at: new Date().toISOString(),
      })),
      { onConflict: "project_id,url" }
    );
  }
  return c.json({ ok: true, results });
});

/**
 * AI link-opportunity scan — one chunk of source items (posts, pages, product
 * category/tag descriptions). Reuses the per-post Gemini mechanism against the
 * synced link_targets catalog, plus two site-wide rules: never suggest the
 * source itself, and skip targets the source already links to.
 */
links.post("/api/projects/:id/links/scan", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");
  const project = await loadProject(sb, projectId);
  if (!project) return c.json({ error: "project not found" }, 404);

  const body = await c.req.json<{ cursor?: { offset: number } }>().catch(() => ({} as { cursor?: { offset: number } }));
  const offset = body.cursor?.offset ?? 0;
  const CHUNK = 4;

  try {
    const auth = await projectAuth(c.env, project);
    const runner = makeCompanionRunner(sb, projectId);

    // Deterministic source list (stable ordering → resumable offsets).
    const { data: sourceRows } = await sb
      .from("link_targets")
      .select("type, wp_id, title, url")
      .eq("project_id", projectId)
      .in("type", ["post", "page", "product_cat", "product_tag"])
      .order("type")
      .order("wp_id");
    const sources = (sourceRows ?? []) as { type: string; wp_id: number; title: string; url: string }[];
    const total = sources.length;
    const slice = sources.slice(offset, offset + CHUNK);

    // Target catalog — same cap as the per-post route (ai.ts).
    const { data: targetRows } = await sb
      .from("link_targets")
      .select("type, title, url")
      .eq("project_id", projectId)
      .limit(500);
    const targets = (targetRows ?? []) as LinkTargetInput[];
    const urlSet = new Set(targets.map((t) => t.url));

    let found = 0;
    for (const src of slice) {
      // Source text: local content when we have it, otherwise rendered from WP.
      let html = "";
      try {
        if (src.type === "post") {
          const { data: local } = await sb
            .from("posts")
            .select("content_html")
            .eq("project_id", projectId)
            .eq("wp_post_id", src.wp_id)
            .maybeSingle();
          html = (local?.content_html as string) || "";
          if (!html) html = (await fetchPostFull(auth, src.wp_id, runner)).content_html;
        } else if (src.type === "page") {
          html = await fetchRenderedContent(auth, "page", src.wp_id, runner);
        } else {
          html = await fetchTermDescription(
            auth,
            src.type as "product_cat" | "product_tag",
            src.wp_id,
            runner
          );
        }
      } catch {
        continue; // unreachable source — skip, don't kill the chunk
      }

      const plain = stripToPlainText(html);
      if (plain.length < 40) continue;

      // Targets this source already links to (skip re-suggestions).
      const { data: existing } = await sb
        .from("site_links")
        .select("target_url")
        .eq("project_id", projectId)
        .eq("source_type", src.type)
        .eq("source_wp_id", src.wp_id);
      const linked = new Set((existing ?? []).map((r) => trimUrl(r.target_url as string)));

      const raw = await suggestInternalLinks(c.env, src.title, plain, targets);
      const seen = new Set<string>();
      const valid = raw.filter((s) => {
        const anchor = (s.anchor ?? "").trim();
        const key = anchor.toLowerCase();
        if (!anchor || anchor.length < 2 || seen.has(key)) return false;
        if (!urlSet.has(s.target_url) || !plain.includes(anchor)) return false;
        if (trimUrl(s.target_url) === trimUrl(src.url)) return false; // self-link
        if (linked.has(trimUrl(s.target_url))) return false; // already links there
        seen.add(key);
        return true;
      });

      if (valid.length) {
        const { error } = await sb.from("link_opportunities").upsert(
          valid.map((s) => ({
            project_id: projectId,
            source_type: src.type,
            source_wp_id: src.wp_id,
            source_title: src.title,
            source_url: src.url,
            anchor_text: s.anchor.trim(),
            target_url: s.target_url,
            target_title: s.target_title ?? "",
            target_type: s.target_type ?? "",
            reason: s.reason ?? "",
          })),
          { onConflict: "project_id,source_type,source_wp_id,target_url", ignoreDuplicates: true }
        );
        if (!error) found += valid.length;
      }
    }

    const nextOffset = offset + slice.length;
    return c.json({
      ok: true,
      done: nextOffset >= total || slice.length === 0,
      cursor: { offset: nextOffset },
      progress: { index: nextOffset, total, found },
    });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "scan failed" }, 500);
  }
});

/**
 * One-click apply: fetch the source's FRESH raw content from WordPress, wrap
 * the anchor, and push only that field back (never pushPost — it would clobber
 * Yoast/terms). Bookkeeping: local post row (when safe), site_links, status.
 */
links.post("/api/projects/:id/links/opportunities/:oid/apply", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const projectId = c.req.param("id");
  const oid = c.req.param("oid");
  const project = await loadProject(sb, projectId);
  if (!project) return c.json({ error: "project not found" }, 404);

  const { data: opp } = await sb
    .from("link_opportunities")
    .select("*")
    .eq("id", oid)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!opp) return c.json({ ok: false, error: "ההצעה לא נמצאה" }, 404);
  if (opp.status !== "suggested" && opp.status !== "failed") {
    return c.json({ ok: false, error: "ההצעה כבר טופלה" }, 400);
  }

  const fail = async (message: string) => {
    await sb
      .from("link_opportunities")
      .update({ status: "failed", error: message })
      .eq("id", oid);
    return c.json({ ok: false, error: message });
  };

  try {
    const auth = await projectAuth(c.env, project);
    const runner = makeCompanionRunner(sb, projectId);
    const isTerm = opp.source_type === "product_cat" || opp.source_type === "product_tag";

    const html = isTerm
      ? await fetchTermDescription(auth, opp.source_type, opp.source_wp_id, runner)
      : await fetchRawContent(auth, opp.source_type as "post" | "page", opp.source_wp_id, runner);

    const updated = applyAnchorLink(html, opp.anchor_text, opp.target_url);
    if (updated == null) {
      return await fail("העוגן לא נמצא בתוכן הנוכחי של העמוד (ייתכן שהתוכן השתנה מאז הסריקה)");
    }

    if (isTerm) {
      await updateTermDescription(auth, opp.source_type, opp.source_wp_id, updated, runner);
    } else {
      await updateContent(auth, opp.source_type as "post" | "page", opp.source_wp_id, updated, runner);
    }

    // Keep the local editor copy in sync — only when it exists, has content,
    // and carries no unpushed local edits (never overwrite a local draft).
    if (opp.source_type === "post") {
      const { data: local } = await sb
        .from("posts")
        .select("id, content_html, local_status")
        .eq("project_id", projectId)
        .eq("wp_post_id", opp.source_wp_id)
        .maybeSingle();
      if (local?.content_html && local.local_status === "pushed") {
        await sb.from("posts").update({ content_html: updated }).eq("id", local.id);
      }
    }

    await sb.from("site_links").insert({
      project_id: projectId,
      source_type: opp.source_type,
      source_wp_id: opp.source_wp_id,
      source_title: opp.source_title,
      source_url: opp.source_url,
      target_url: opp.target_url,
      anchor_text: opp.anchor_text,
      is_internal: true, // targets come from link_targets — always internal
    });

    await sb
      .from("link_opportunities")
      .update({ status: "applied", applied_at: new Date().toISOString(), error: null })
      .eq("id", oid);
    return c.json({ ok: true });
  } catch (e) {
    return await fail(e instanceof Error ? e.message : "החלת הקישור נכשלה");
  }
});
