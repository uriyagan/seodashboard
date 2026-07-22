/**
 * Minimal WordPress REST API client (runs in the Worker).
 * Auth via Application Passwords (HTTP Basic).
 */

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
  date: string | null;
  modified: string | null;
  categories: number[];
  tags: number[];
}

function authHeader(auth: WpAuth): string {
  return "Basic " + btoa(`${auth.username}:${auth.appPassword}`);
}

// Some hosts (e.g. SiteGround) block browser-like User-Agents coming from
// datacenter IPs and return an HTML block page. A neutral custom UA passes.
const USER_AGENT = "SEO-Dashboard/1.0 (+https://seo.uriyaganor.com)";

/** Standard headers for WP REST calls, with UA + optional auth + extras. */
function wpHeaders(auth?: WpAuth, extra?: Record<string, string>): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    ...(auth ? { Authorization: authHeader(auth) } : {}),
    ...extra,
  };
}

function apiBase(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "") + "/wp-json/wp/v2";
}

/** Checks that the WordPress REST API is reachable (no auth needed). */
export async function checkRestReachable(
  siteUrl: string
): Promise<{ ok: boolean; namespaces?: string[]; error?: string }> {
  try {
    const url = siteUrl.replace(/\/+$/, "") + "/wp-json/";
    const res = await fetch(url, { headers: wpHeaders() });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { namespaces?: string[] };
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
  auth: WpAuth
): Promise<{ ok: boolean; user?: string; error?: string }> {
  try {
    const res = await fetch(apiBase(auth.siteUrl) + "/users/me?context=edit", {
      headers: wpHeaders(auth),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "אימות נכשל — שם משתמש או Application Password שגויים" };
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { name?: string; slug?: string };
    return { ok: true, user: json.name ?? json.slug };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

/** Detects whether the Yoast SEO plugin exposes its namespace. */
export async function detectYoast(siteUrl: string): Promise<boolean> {
  const check = await checkRestReachable(siteUrl);
  return check.namespaces?.some((n) => n.startsWith("yoast")) ?? false;
}

/** Fetches all terms of a taxonomy (categories or post_tag), paginated. */
export async function fetchAllTerms(
  auth: WpAuth,
  taxonomy: "categories" | "tags"
): Promise<WpTerm[]> {
  const out: WpTerm[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(
      `${apiBase(auth.siteUrl)}/${taxonomy}?per_page=100&page=${page}&_fields=id,name,slug,count`,
      { headers: wpHeaders(auth) }
    );
    if (!res.ok) break;
    const batch = (await res.json()) as WpTerm[];
    out.push(...batch);
    const totalPages = Number(res.headers.get("X-WP-TotalPages") ?? "1");
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
  focus_keyword: string;
  seo_title: string;
  meta_description: string;
}

/** Fetches a single post's full content + Yoast meta (context=edit). */
export async function fetchPostFull(auth: WpAuth, wpId: number): Promise<WpPostFull> {
  const res = await fetch(
    `${apiBase(auth.siteUrl)}/posts/${wpId}?context=edit&_fields=id,title,content,status,categories,tags,featured_media,meta,yoast_head_json`,
    { headers: wpHeaders(auth) }
  );
  if (!res.ok) throw new Error(`fetch post ${wpId} failed: HTTP ${res.status}`);
  const p = (await res.json()) as {
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
  return {
    id: p.id,
    title: p.title?.raw ?? p.title?.rendered ?? "",
    content_html: p.content?.raw ?? p.content?.rendered ?? "",
    status: p.status,
    categories: p.categories ?? [],
    tags: p.tags ?? [],
    featured_media: p.featured_media ?? 0,
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
  categories: number[];
  tags: number[];
  featured_media?: number | null;
  focus_keyword?: string;
  seo_title?: string;
  meta_description?: string;
}

/** Creates or updates a post on WordPress, always as a draft. Sets Yoast meta. */
export async function pushPost(auth: WpAuth, input: PushPostInput): Promise<number> {
  const isUpdate = Boolean(input.wpId);
  const url = isUpdate
    ? `${apiBase(auth.siteUrl)}/posts/${input.wpId}`
    : `${apiBase(auth.siteUrl)}/posts`;

  const body: Record<string, unknown> = {
    title: input.title,
    content: input.content_html,
    status: "draft", // always draft
    categories: input.categories,
    tags: input.tags,
    // Requires the companion mu-plugin to expose these Yoast meta keys to REST.
    meta: {
      _yoast_wpseo_focuskw: input.focus_keyword ?? "",
      _yoast_wpseo_title: input.seo_title ?? "",
      _yoast_wpseo_metadesc: input.meta_description ?? "",
    },
  };
  if (input.featured_media) body.featured_media = input.featured_media;

  const res = await fetch(url, {
    method: "POST",
    headers: wpHeaders(auth, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`push post failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id: number };
  return json.id;
}

/** Creates a new category or tag; returns its id + name. */
export async function createTerm(
  auth: WpAuth,
  taxonomy: "categories" | "tags",
  name: string
): Promise<WpTerm> {
  const res = await fetch(`${apiBase(auth.siteUrl)}/${taxonomy}`, {
    method: "POST",
    headers: wpHeaders(auth, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    // Term may already exist — surface a clean error.
    const detail = await res.text().catch(() => "");
    throw new Error(`create term failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id: number; name: string; slug: string };
  return { id: json.id, name: json.name, slug: json.slug };
}

/** Uploads an image to the WordPress media library; returns id + source URL. */
export async function uploadMedia(
  auth: WpAuth,
  bytes: Uint8Array,
  filename: string,
  mimeType: string
): Promise<{ id: number; url: string }> {
  const res = await fetch(`${apiBase(auth.siteUrl)}/media`, {
    method: "POST",
    headers: wpHeaders(auth, {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    }),
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`upload media failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id: number; source_url: string };
  return { id: json.id, url: json.source_url };
}

/** Fetches all posts (metadata + titles), paginated. Content is fetched lazily elsewhere. */
export async function fetchAllPosts(auth: WpAuth): Promise<WpPostSummary[]> {
  const out: WpPostSummary[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(
      `${apiBase(auth.siteUrl)}/posts?per_page=100&page=${page}&status=publish,draft,pending,private,future&_fields=id,title,status,link,date,modified,categories,tags`,
      { headers: wpHeaders(auth) }
    );
    if (!res.ok) break;
    const batch = (await res.json()) as Array<{
      id: number;
      title: { rendered: string };
      status: string;
      link: string;
      date: string | null;
      modified: string | null;
      categories?: number[];
      tags?: number[];
    }>;
    for (const p of batch) {
      out.push({
        id: p.id,
        title: p.title?.rendered ?? "",
        status: p.status,
        link: p.link,
        date: p.date,
        modified: p.modified,
        categories: p.categories ?? [],
        tags: p.tags ?? [],
      });
    }
    const totalPages = Number(res.headers.get("X-WP-TotalPages") ?? "1");
    if (page >= totalPages || batch.length === 0) break;
    page++;
  }
  return out;
}
