/**
 * WordPress REST API client (runs in the Worker).
 * Auth via Application Passwords (HTTP Basic).
 *
 * WAF resilience (learned from the WooDonkey project): some hosts (e.g. SiteGround)
 * challenge datacenter requests to the literal `/wp-json/` path with an HTML
 * anti-bot page (sgcaptcha) — even a 200 carrying HTML, which makes `res.json()`
 * throw the cryptic "Unexpected token '<'". To get around it every request tries
 * TWO URL forms: the pretty `/wp-json/...` path, then the `?rest_route=...` query
 * form on the site root (which those WAFs typically leave open). A full browser
 * User-Agent is also sent, since bot-like UAs get 403'd.
 */

import type { CompanionRunner } from "./companion";

export interface WpAuth {
  siteUrl: string;
  username: string;
  appPassword: string;
}

export interface WpTerm {
  id: number;
  name: string;
  slug: string;
  count?: number;
}

export interface WpPostSummary {
  id: number;
  title: string;
  status: string; // publish | draft | pending | private | future
  link: string;
  image: string;
  date: string | null;
  modified: string | null;
  categories: number[];
  tags: number[];
}

function authHeader(auth: WpAuth): string {
  return "Basic " + btoa(`${auth.username}:${auth.appPassword}`);
}

// A real browser UA — hosts' anti-bot/WAF 403-challenge bot-identifying UAs.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function siteBase(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "");
}

/** Builds the pretty `/wp-json` URL and the `?rest_route=` fallback URL for a route. */
function buildUrls(
  siteUrl: string,
  route: string,
  query: Record<string, string | number>
): string[] {
  const b = siteBase(siteUrl);
  const pretty = new URL(`${b}/wp-json${route}`);
  const rr = new URL(`${b}/`);
  rr.searchParams.set("rest_route", route === "" ? "/" : route);
  for (const [k, v] of Object.entries(query)) {
    pretty.searchParams.set(k, String(v));
    rr.searchParams.set(k, String(v));
  }
  return [pretty.toString(), rr.toString()];
}

interface WpResult {
  status: number;
  headers: Headers;
  text: string;
}

/**
 * Core request: tries the pretty path then the ?rest_route= form. A transport
 * error or a non-JSON body (WAF HTML challenge) falls through to the next form;
 * a JSON body — even an error status — is a real response and is returned.
 */
async function wpFetch(
  siteUrl: string,
  auth: WpAuth | undefined,
  route: string,
  init: RequestInit = {},
  query: Record<string, string | number> = {},
  runner?: CompanionRunner
): Promise<WpResult> {
  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Accept: "application/json",
    ...(auth ? { Authorization: authHeader(auth) } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };

  let lastErr = "blocked";
  for (const url of buildUrls(siteUrl, route, query)) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "fetch failed";
      continue; // transport-level block — try the next form
    }
    const text = await res.text();
    const trimmed = text.trim();
    if (trimmed === "") {
      if (res.ok) return { status: res.status, headers: res.headers, text: "" };
      lastErr = `HTTP ${res.status}`;
      continue;
    }
    try {
      JSON.parse(trimmed);
    } catch {
      lastErr = `blocked by host firewall (HTTP ${res.status})`;
      continue; // HTML challenge — try the next form
    }
    return { status: res.status, headers: res.headers, text };
  }

  // Both direct forms blocked. Last resort: run it inside the site via the
  // companion queue (the site's snippet polls us, runs it, posts back).
  if (runner) {
    const bodyStr = typeof init.body === "string" ? init.body : undefined;
    let bodyObj: unknown;
    if (bodyStr) {
      try {
        bodyObj = JSON.parse(bodyStr);
      } catch {
        bodyObj = bodyStr;
      }
    }
    const result = await runner({
      method: (init.method as string) ?? "GET",
      route,
      query,
      body: bodyObj,
    });
    const h = new Headers();
    for (const [k, v] of Object.entries(result.headers ?? {})) {
      if (v != null) h.set(k, String(v));
    }
    return {
      status: result.status,
      headers: h,
      text: JSON.stringify(result.body ?? null),
    };
  }

  throw new Error(lastErr);
}

/** Checks that the WordPress REST API is reachable (no auth needed). */
export async function checkRestReachable(
  siteUrl: string,
  runner?: CompanionRunner
): Promise<{ ok: boolean; namespaces?: string[]; error?: string }> {
  try {
    const r = await wpFetch(siteUrl, undefined, "/", {}, {}, runner);
    const json = JSON.parse(r.text) as { namespaces?: string[] };
    if (!json.namespaces?.includes("wp/v2")) {
      return { ok: false, error: "WordPress REST API (wp/v2) not found" };
    }
    return { ok: true, namespaces: json.namespaces };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

/** Verifies credentials by requesting the authenticated user. */
export async function testConnection(
  auth: WpAuth,
  runner?: CompanionRunner
): Promise<{ ok: boolean; user?: string; error?: string }> {
  try {
    const r = await wpFetch(auth.siteUrl, auth, "/wp/v2/users/me", {}, { context: "edit" }, runner);
    if (r.status === 401 || r.status === 403) {
      return { ok: false, error: "אימות נכשל — שם משתמש או Application Password שגויים" };
    }
    if (r.status >= 400) return { ok: false, error: `HTTP ${r.status}` };
    const json = JSON.parse(r.text) as { name?: string; slug?: string };
    return { ok: true, user: json.name ?? json.slug };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

/** Detects whether the Yoast SEO plugin exposes its namespace. */
export async function detectYoast(siteUrl: string, runner?: CompanionRunner): Promise<boolean> {
  const check = await checkRestReachable(siteUrl, runner);
  return check.namespaces?.some((n) => n.startsWith("yoast")) ?? false;
}

/** Fetches all terms of a taxonomy (categories or post_tag), paginated. */
export async function fetchAllTerms(
  auth: WpAuth,
  taxonomy: "categories" | "tags",
  runner?: CompanionRunner
): Promise<WpTerm[]> {
  const out: WpTerm[] = [];
  let page = 1;
  for (;;) {
    const r = await wpFetch(auth.siteUrl, auth, `/wp/v2/${taxonomy}`, {}, {
      per_page: 100,
      page,
      _fields: "id,name,slug,count",
    }, runner);
    if (r.status >= 400) break;
    const batch = JSON.parse(r.text) as WpTerm[];
    out.push(...batch);
    const totalPages = Number(r.headers.get("X-WP-TotalPages") ?? "1");
    if (page >= totalPages || batch.length === 0) break;
    page++;
  }
  return out;
}

export interface WpPostFull {
  id: number;
  title: string;
  content_html: string;
  status: string;
  categories: number[];
  tags: number[];
  featured_media: number;
  featured_image_url: string;
  focus_keyword: string;
  seo_title: string;
  meta_description: string;
}

/** Resolves a media attachment's source URL by id. */
export async function fetchMediaUrl(
  auth: WpAuth,
  mediaId: number,
  runner?: CompanionRunner
): Promise<string> {
  if (!mediaId) return "";
  try {
    const r = await wpFetch(auth.siteUrl, auth, `/wp/v2/media/${mediaId}`, {}, {
      _fields: "source_url",
    }, runner);
    if (r.status >= 400) return "";
    return (JSON.parse(r.text) as { source_url?: string }).source_url ?? "";
  } catch {
    return "";
  }
}

/** Fetches a single post's full content + Yoast meta (context=edit). */
export async function fetchPostFull(
  auth: WpAuth,
  wpId: number,
  runner?: CompanionRunner
): Promise<WpPostFull> {
  const r = await wpFetch(auth.siteUrl, auth, `/wp/v2/posts/${wpId}`, {}, {
    context: "edit",
    _fields: "id,title,content,status,categories,tags,featured_media,meta,yoast_head_json",
  }, runner);
  if (r.status >= 400) throw new Error(`fetch post ${wpId} failed: HTTP ${r.status}`);
  const p = JSON.parse(r.text) as {
    id: number;
    title: { raw?: string; rendered: string };
    content: { raw?: string; rendered: string };
    status: string;
    categories?: number[];
    tags?: number[];
    featured_media?: number;
    meta?: Record<string, string>;
    yoast_head_json?: { title?: string; description?: string };
  };
  const featured_media = p.featured_media ?? 0;
  return {
    id: p.id,
    title: p.title?.raw ?? p.title?.rendered ?? "",
    content_html: p.content?.raw ?? p.content?.rendered ?? "",
    status: p.status,
    categories: p.categories ?? [],
    tags: p.tags ?? [],
    featured_media,
    featured_image_url: await fetchMediaUrl(auth, featured_media, runner),
    focus_keyword: p.meta?._yoast_wpseo_focuskw ?? "",
    seo_title: p.meta?._yoast_wpseo_title ?? p.yoast_head_json?.title ?? "",
    meta_description:
      p.meta?._yoast_wpseo_metadesc ?? p.yoast_head_json?.description ?? "",
  };
}

export interface PushPostInput {
  wpId?: number | null;
  title: string;
  content_html: string;
  status: string; // draft | publish | pending | private
  categories: number[];
  tags: number[];
  featured_media?: number | null;
  focus_keyword?: string;
  seo_title?: string;
  meta_description?: string;
}

/** Creates or updates a post on WordPress at the given status. Sets Yoast meta. */
export async function pushPost(
  auth: WpAuth,
  input: PushPostInput,
  runner?: CompanionRunner
): Promise<number> {
  const route = input.wpId ? `/wp/v2/posts/${input.wpId}` : "/wp/v2/posts";
  const body: Record<string, unknown> = {
    title: input.title,
    content: input.content_html,
    status: input.status || "draft",
    categories: input.categories,
    tags: input.tags,
    // Requires the Yoast REST snippet on the site to persist these meta keys.
    meta: {
      _yoast_wpseo_focuskw: input.focus_keyword ?? "",
      _yoast_wpseo_title: input.seo_title ?? "",
      _yoast_wpseo_metadesc: input.meta_description ?? "",
    },
  };
  if (input.featured_media) body.featured_media = input.featured_media;

  const r = await wpFetch(auth.siteUrl, auth, route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, {}, runner);
  if (r.status >= 400) {
    throw new Error(`push post failed: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  }
  return (JSON.parse(r.text) as { id: number }).id;
}

/** Creates a new category or tag; returns its id + name. */
export async function createTerm(
  auth: WpAuth,
  taxonomy: "categories" | "tags",
  name: string,
  runner?: CompanionRunner
): Promise<WpTerm> {
  const r = await wpFetch(auth.siteUrl, auth, `/wp/v2/${taxonomy}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }, {}, runner);
  if (r.status >= 400) {
    throw new Error(`create term failed: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  }
  const json = JSON.parse(r.text) as { id: number; name: string; slug: string };
  return { id: json.id, name: json.name, slug: json.slug };
}

/** Uploads an image to the WordPress media library; returns id + source URL. */
export async function uploadMedia(
  auth: WpAuth,
  bytes: Uint8Array,
  filename: string,
  mimeType: string
): Promise<{ id: number; url: string }> {
  const r = await wpFetch(auth.siteUrl, auth, "/wp/v2/media", {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
    body: bytes as unknown as BodyInit,
  });
  if (r.status >= 400) {
    throw new Error(`upload media failed: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  }
  const json = JSON.parse(r.text) as { id: number; source_url: string };
  return { id: json.id, url: json.source_url };
}

export interface LinkTarget {
  id: number;
  title: string;
  url: string;
}

export interface SyncPayload {
  posts: WpPostSummary[];
  categories: WpTerm[];
  tags: WpTerm[];
  yoast: boolean;
  pages: LinkTarget[];
  productCategories: LinkTarget[];
  productTags: LinkTarget[];
}

/** Fetches published pages as link targets (paginated). */
export async function fetchPages(auth: WpAuth, runner?: CompanionRunner): Promise<LinkTarget[]> {
  const out: LinkTarget[] = [];
  let page = 1;
  for (;;) {
    const r = await wpFetch(auth.siteUrl, auth, "/wp/v2/pages", {}, {
      per_page: 100,
      page,
      status: "publish",
      _fields: "id,title,link",
    }, runner);
    if (r.status >= 400) break;
    const batch = JSON.parse(r.text) as Array<{ id: number; title: { rendered: string }; link: string }>;
    for (const p of batch) out.push({ id: p.id, title: p.title?.rendered ?? "", url: p.link });
    const totalPages = Number(r.headers.get("X-WP-TotalPages") ?? "1");
    if (page >= totalPages || batch.length === 0) break;
    page++;
  }
  return out;
}

/** Fetches WooCommerce product terms (product_cat / product_tag) as link targets. */
export async function fetchProductTerms(
  auth: WpAuth,
  taxonomy: "product_cat" | "product_tag",
  runner?: CompanionRunner
): Promise<LinkTarget[]> {
  const out: LinkTarget[] = [];
  let page = 1;
  for (;;) {
    const r = await wpFetch(auth.siteUrl, auth, `/wp/v2/${taxonomy}`, {}, {
      per_page: 100,
      page,
      _fields: "id,name,link",
    }, runner);
    if (r.status >= 400) break; // taxonomy may not exist (no WooCommerce)
    const batch = JSON.parse(r.text) as Array<{ id: number; name: string; link: string }>;
    for (const t of batch) out.push({ id: t.id, title: t.name, url: t.link });
    const totalPages = Number(r.headers.get("X-WP-TotalPages") ?? "1");
    if (page >= totalPages || batch.length === 0) break;
    page++;
  }
  return out;
}

/**
 * One-call sync via the companion route `/seodash/v1/sync` (returns all posts +
 * taxonomies + Yoast presence in a single request). This is a single companion
 * job for firewalled sites (fast), and a single direct call for reachable ones.
 * Returns null if the route is missing (404) so callers can fall back.
 */
export async function fetchSyncPayload(
  auth: WpAuth,
  runner?: CompanionRunner
): Promise<SyncPayload | null> {
  const r = await wpFetch(auth.siteUrl, auth, "/seodash/v1/sync", {}, {}, runner);
  if (r.status === 404) return null;
  if (r.status >= 400) throw new Error(`sync route HTTP ${r.status}`);
  const d = JSON.parse(r.text) as {
    posts?: WpPostSummary[];
    categories?: WpTerm[];
    tags?: WpTerm[];
    yoast?: boolean;
    pages?: Array<{ id: number; title: string; link: string }>;
    product_categories?: Array<{ id: number; name: string; link: string }>;
    product_tags?: Array<{ id: number; name: string; link: string }>;
  };
  const mapTargets = (
    arr: Array<{ id: number; title?: string; name?: string; link: string }> | undefined
  ): LinkTarget[] => (arr ?? []).map((t) => ({ id: t.id, title: t.title ?? t.name ?? "", url: t.link }));
  return {
    posts: d.posts ?? [],
    categories: d.categories ?? [],
    tags: d.tags ?? [],
    yoast: Boolean(d.yoast),
    pages: mapTargets(d.pages),
    productCategories: mapTargets(d.product_categories),
    productTags: mapTargets(d.product_tags),
  };
}

/** Fetches all posts (metadata + titles), paginated. Content is fetched lazily elsewhere. */
export async function fetchAllPosts(
  auth: WpAuth,
  runner?: CompanionRunner
): Promise<WpPostSummary[]> {
  const out: WpPostSummary[] = [];
  let page = 1;
  for (;;) {
    const r = await wpFetch(auth.siteUrl, auth, "/wp/v2/posts", {}, {
      per_page: 100,
      page,
      status: "publish,draft,pending,private,future",
      _embed: "wp:featuredmedia",
      _fields: "id,title,status,link,date,modified,categories,tags,_links,_embedded",
    }, runner);
    if (r.status >= 400) break;
    const batch = JSON.parse(r.text) as Array<{
      id: number;
      title: { rendered: string };
      status: string;
      link: string;
      date: string | null;
      modified: string | null;
      categories?: number[];
      tags?: number[];
      _embedded?: { "wp:featuredmedia"?: Array<{ source_url?: string; media_details?: { sizes?: { medium?: { source_url?: string } } } }> };
    }>;
    for (const p of batch) {
      const media = p._embedded?.["wp:featuredmedia"]?.[0];
      out.push({
        id: p.id,
        title: p.title?.rendered ?? "",
        status: p.status,
        link: p.link,
        image: media?.media_details?.sizes?.medium?.source_url ?? media?.source_url ?? "",
        date: p.date,
        modified: p.modified,
        categories: p.categories ?? [],
        tags: p.tags ?? [],
      });
    }
    const totalPages = Number(r.headers.get("X-WP-TotalPages") ?? "1");
    if (page >= totalPages || batch.length === 0) break;
    page++;
  }
  return out;
}
