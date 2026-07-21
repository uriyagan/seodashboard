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

function apiBase(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "") + "/wp-json/wp/v2";
}

/** Checks that the WordPress REST API is reachable (no auth needed). */
export async function checkRestReachable(
  siteUrl: string
): Promise<{ ok: boolean; namespaces?: string[]; error?: string }> {
  try {
    const url = siteUrl.replace(/\/+$/, "") + "/wp-json/";
    const res = await fetch(url, { headers: { Accept: "application/json" } });
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
      headers: { Authorization: authHeader(auth), Accept: "application/json" },
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
      { headers: { Authorization: authHeader(auth), Accept: "application/json" } }
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

/** Fetches all posts (metadata + titles), paginated. Content is fetched lazily elsewhere. */
export async function fetchAllPosts(auth: WpAuth): Promise<WpPostSummary[]> {
  const out: WpPostSummary[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(
      `${apiBase(auth.siteUrl)}/posts?per_page=100&page=${page}&status=publish,draft,pending,private,future&_fields=id,title,status,link,date,modified,categories,tags`,
      { headers: { Authorization: authHeader(auth), Accept: "application/json" } }
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
