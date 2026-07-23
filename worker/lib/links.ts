/**
 * Internal-links feature: link extraction from WordPress content, server-side
 * anchor wrapping (the "apply" of an AI suggestion), broken-URL probing, and
 * the chunked inventory refresh shared by the route and the daily cron.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanionRunner } from "./companion";
import {
  BROWSER_UA,
  fetchContentPage,
  fetchProductsContentPage,
  fetchTermsWithDescription,
  type RelayConfig,
  type WpAuth,
  type WpContentItem,
} from "./wordpress";

/** Decode a handful of common HTML entities in rendered titles/anchors. */
export function decodeEntities(s: string): string {
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

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

export interface ExtractedLink {
  target_url: string;
  anchor_text: string;
  is_internal: boolean;
}

const SKIP_HREF = /^(mailto:|tel:|javascript:|data:|#)/i;

/** Hostname, lowercased, without a leading "www." — for internal detection. */
export function normalizeHost(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Same host (scheme-agnostic, www-insensitive) as the project's site. */
export function isInternalUrl(url: string, siteUrl: string): boolean {
  const h = normalizeHost(url);
  return h !== "" && h === normalizeHost(siteUrl);
}

/**
 * Extracts every <a href> from an HTML fragment. Anchors are stripped to plain
 * text; hrefs are entity-decoded (&amp; in URLs), resolved against the source
 * URL, and fragment-stripped. Dedupes identical (target, anchor) pairs.
 */
export function extractLinks(
  html: string,
  sourceUrl: string,
  siteUrl: string
): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const seen = new Set<string>();
  const re =
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? ""))) {
    const href = decodeEntities((m[1] ?? m[2] ?? m[3] ?? "").trim());
    if (!href || SKIP_HREF.test(href)) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, sourceUrl || siteUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    resolved.hash = "";
    const target = resolved.toString();
    const anchor = decodeEntities(m[4].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    const key = `${target}|${anchor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      target_url: target,
      anchor_text: anchor,
      is_internal: isInternalUrl(target, siteUrl),
    });
  }
  return out;
}

/** Plain text with already-linked spans removed (so anchors can't be re-suggested). */
export function stripToPlainText(html: string): string {
  return (html ?? "")
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Apply (server-side port of the editor's applyLinkSuggestion)        */
/* ------------------------------------------------------------------ */

/** True when idx sits inside the attribute section of an unclosed [vc_/[us_ shortcode. */
function insideShortcodeAttrs(text: string, idx: number): boolean {
  const ctx = text.slice(Math.max(0, idx - 600), idx);
  const lastOpen = Math.max(ctx.lastIndexOf("[vc_"), ctx.lastIndexOf("[us_"));
  if (lastOpen === -1) return false;
  return ctx.indexOf("]", lastOpen) === -1;
}

/**
 * Wraps the first non-linked occurrence of `anchor` with <a href>. Tries the
 * decoded anchor and an &amp;-encoded variant (WP raw content stores entities).
 * Refuses matches inside page-builder shortcode attributes — a clean failure
 * beats corrupting an Impreza page. Returns null when the anchor can't be placed.
 */
export function applyAnchorLink(
  html: string,
  anchor: string,
  url: string
): string | null {
  const variants = [anchor, anchor.replace(/&/g, "&amp;")].filter(
    (v, i, arr) => v.length >= 2 && arr.indexOf(v) === i
  );
  for (const candidate of variants) {
    const parts = html.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/gi);
    let done = false;
    for (let i = 0; i < parts.length && !done; i++) {
      if (/^<a\b/i.test(parts[i])) continue; // don't touch existing links
      let idx = parts[i].indexOf(candidate);
      while (idx !== -1) {
        if (!insideShortcodeAttrs(parts[i], idx)) {
          parts[i] =
            parts[i].slice(0, idx) +
            `<a href="${url}">${candidate}</a>` +
            parts[i].slice(idx + candidate.length);
          done = true;
          break;
        }
        idx = parts[i].indexOf(candidate, idx + 1);
      }
    }
    if (done) return parts.join("");
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Broken-link probing                                                 */
/* ------------------------------------------------------------------ */

export interface ProbeResult {
  status: number | null;
  result: "ok" | "broken" | "error";
  error?: string;
}

/** Only a definite "gone" counts as broken — bot-hostile hosts (403/999/405) are "error". */
function classify(status: number | null): "ok" | "broken" | "error" {
  if (status == null) return "error";
  if (status >= 200 && status < 400) return "ok";
  if (status === 404 || status === 410) return "broken";
  return "error";
}

async function directProbe(url: string, method: "HEAD" | "GET"): Promise<number | null> {
  try {
    const res = await fetch(url, {
      method,
      redirect: "follow",
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (method === "GET") await res.body?.cancel();
    return res.status;
  } catch {
    return null;
  }
}

/** Probes a URL through the static-IP relay (raw status — no JSON requirement). */
async function relayProbe(url: string, relay: RelayConfig): Promise<number | null> {
  try {
    const rr = await fetch(relay.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: relay.secret,
        url,
        method: "GET",
        headers: { "User-Agent": BROWSER_UA },
      }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!rr.ok) return null;
    const payload = (await rr.json()) as { status?: number };
    return typeof payload.status === "number" ? payload.status : null;
  } catch {
    return null;
  }
}

/**
 * Checks a URL's HTTP status. When a relay is given (internal URLs on
 * firewalled hosts) it is used FIRST — a direct hit on a SiteGround front page
 * returns the sgcaptcha challenge with a 2xx, which would read as a false "ok".
 * Externals probe directly: HEAD, then GET when HEAD is rejected.
 */
export async function probeUrl(url: string, relay?: RelayConfig): Promise<ProbeResult> {
  let status: number | null = null;
  if (relay) {
    status = await relayProbe(url, relay);
    if (status == null) status = await directProbe(url, "GET");
  } else {
    status = await directProbe(url, "HEAD");
    if (status == null || status === 403 || status === 405 || status === 501) {
      const viaGet = await directProbe(url, "GET");
      if (viaGet != null) status = viaGet;
    }
  }
  const result = classify(status);
  return {
    status,
    result,
    error: result === "error" ? (status == null ? "לא ניתן להגיע לכתובת" : `HTTP ${status}`) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Inventory refresh (chunked; shared by the route and the cron)       */
/* ------------------------------------------------------------------ */

export type RefreshPhase = "posts" | "pages" | "products" | "terms" | "done";

export interface RefreshCursor {
  phase: RefreshPhase;
  page: number;
}

export type SourceType = "post" | "page" | "product" | "product_cat" | "product_tag";

/** Extracts + inserts the links of a batch of content items. Returns row count. */
async function insertLinks(
  sb: SupabaseClient,
  projectId: string,
  siteUrl: string,
  sourceType: SourceType,
  items: WpContentItem[]
): Promise<number> {
  const rows: Record<string, unknown>[] = [];
  for (const item of items) {
    for (const l of extractLinks(item.html, item.link, siteUrl)) {
      rows.push({
        project_id: projectId,
        source_type: sourceType,
        source_wp_id: item.id,
        source_title: decodeEntities(item.title).slice(0, 300),
        source_url: item.link,
        target_url: l.target_url,
        anchor_text: l.anchor_text,
        is_internal: l.is_internal,
      });
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("site_links").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

/**
 * Runs ONE chunk of the inventory refresh: fetches a single page of content of
 * the cursor's phase, extracts its links, and advances the cursor
 * (posts → pages → products → terms → done). The very first chunk wipes the
 * project's inventory (full refresh). The last chunk stamps links_synced_at.
 */
export async function refreshLinksChunk(
  sb: SupabaseClient,
  projectId: string,
  siteUrl: string,
  auth: WpAuth,
  cursor: RefreshCursor | undefined,
  runner?: CompanionRunner
): Promise<{ next: RefreshCursor; inserted: number; totalPages: number }> {
  const cur: RefreshCursor = cursor ?? { phase: "posts", page: 1 };

  if (cur.phase === "posts" && cur.page === 1) {
    const { error } = await sb.from("site_links").delete().eq("project_id", projectId);
    if (error) throw new Error(error.message);
  }

  if (cur.phase === "done") return { next: cur, inserted: 0, totalPages: 0 };

  if (cur.phase === "terms") {
    let inserted = 0;
    for (const taxonomy of ["product_cat", "product_tag"] as const) {
      const terms = await fetchTermsWithDescription(auth, taxonomy, runner);
      inserted += await insertLinks(sb, projectId, siteUrl, taxonomy, terms);
    }
    await sb
      .from("projects")
      .update({ links_synced_at: new Date().toISOString() })
      .eq("id", projectId);
    return { next: { phase: "done", page: 1 }, inserted, totalPages: 1 };
  }

  const { items, totalPages } =
    cur.phase === "products"
      ? await fetchProductsContentPage(auth, cur.page, runner)
      : await fetchContentPage(auth, cur.phase, cur.page, runner);

  const sourceType: SourceType =
    cur.phase === "posts" ? "post" : cur.phase === "pages" ? "page" : "product";
  const inserted = await insertLinks(sb, projectId, siteUrl, sourceType, items);

  const nextPhase: RefreshPhase =
    cur.phase === "posts" ? "pages" : cur.phase === "pages" ? "products" : "terms";
  const next: RefreshCursor =
    cur.page < totalPages && items.length > 0
      ? { phase: cur.phase, page: cur.page + 1 }
      : { phase: nextPhase, page: 1 };
  return { next, inserted, totalPages };
}

/** Full server-side refresh loop — used by the daily cron. */
export async function refreshAllLinks(
  sb: SupabaseClient,
  projectId: string,
  siteUrl: string,
  auth: WpAuth,
  runner?: CompanionRunner
): Promise<number> {
  let cursor: RefreshCursor | undefined;
  let inserted = 0;
  // Hard cap far above any real site (60 product pages + posts + pages).
  for (let i = 0; i < 500; i++) {
    const step = await refreshLinksChunk(sb, projectId, siteUrl, auth, cursor, runner);
    inserted += step.inserted;
    cursor = step.next;
    if (cursor.phase === "done") break;
  }
  return inserted;
}

/**
 * Replaces the stored links of a single source item (delete + insert) — used
 * after a post is pushed from the editor so the inventory stays current.
 */
export async function replaceSourceLinks(
  sb: SupabaseClient,
  projectId: string,
  siteUrl: string,
  sourceType: SourceType,
  wpId: number,
  title: string,
  sourceUrl: string,
  html: string
): Promise<void> {
  await sb
    .from("site_links")
    .delete()
    .eq("project_id", projectId)
    .eq("source_type", sourceType)
    .eq("source_wp_id", wpId);
  await insertLinks(sb, projectId, siteUrl, sourceType, [
    { id: wpId, title, link: sourceUrl, html },
  ]);
}
