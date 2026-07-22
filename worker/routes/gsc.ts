import { Hono } from "hono";
import type { Env } from "../index";
import { requireAdmin } from "../lib/supabase";
import { encrypt, decrypt } from "../lib/crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const gsc = new Hono<{ Bindings: Env }>();

const SCOPES =
  "openid email https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function redirectUri(req: Request): string {
  return new URL(req.url).origin + "/api/gsc/callback";
}

// ---- base64url + HMAC-signed OAuth state (CSRF / tamper protection) ----
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    b64ToBytes(env.ENCRYPTION_KEY!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
async function signState(env: Env): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify({ exp: Date.now() + 600_000 }));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env), data));
  return bytesToB64url(data) + "." + bytesToB64url(sig);
}
async function verifyState(env: Env, state: string | undefined): Promise<boolean> {
  if (!state) return false;
  const [p, s] = state.split(".");
  if (!p || !s) return false;
  const data = b64ToBytes(p);
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(env), b64ToBytes(s), data);
  if (!ok) return false;
  try {
    return JSON.parse(new TextDecoder().decode(data)).exp > Date.now();
  } catch {
    return false;
  }
}

interface ConnRow {
  id: string;
  google_email: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  token_expiry: string;
}

/** Loads the caller's connection (RLS-scoped) and returns a fresh access token, refreshing if needed. */
async function accessToken(
  env: Env,
  sb: SupabaseClient
): Promise<{ token: string; email: string | null } | null> {
  const { data } = await sb
    .from("gsc_connections")
    .select("id, google_email, access_token_enc, refresh_token_enc, token_expiry")
    .limit(1);
  const conn = (data?.[0] as ConnRow | undefined) ?? null;
  if (!conn) return null;

  let token = await decrypt(conn.access_token_enc, env.ENCRYPTION_KEY!);
  if (new Date(conn.token_expiry).getTime() < Date.now() + 60_000) {
    if (!conn.refresh_token_enc) return null;
    const refresh = await decrypt(conn.refresh_token_enc, env.ENCRYPTION_KEY!);
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GSC_CLIENT_ID!,
        client_secret: env.GSC_CLIENT_SECRET!,
        refresh_token: refresh,
        grant_type: "refresh_token",
      }),
    });
    const t = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!res.ok || !t.access_token) return null;
    token = t.access_token;
    await sb
      .from("gsc_connections")
      .update({
        access_token_enc: await encrypt(token, env.ENCRYPTION_KEY!),
        token_expiry: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conn.id);
  }
  return { token, email: conn.google_email };
}

/** Step 1 — return the Google consent URL (opened by the SPA). */
gsc.get("/api/gsc/authorize", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  if (!c.env.GSC_CLIENT_ID) return c.json({ error: "GSC לא מוגדר בשרת" }, 500);

  const params = new URLSearchParams({
    client_id: c.env.GSC_CLIENT_ID,
    redirect_uri: redirectUri(c.req.raw),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: await signState(c.env),
  });
  return c.json({ url: `${AUTH_URL}?${params.toString()}` });
});

/** Step 2 — Google redirects here; bounce back into the SPA with code+state. */
gsc.get("/api/gsc/callback", (c) => {
  const url = new URL(c.req.url);
  const dest = new URL(url.origin);
  dest.pathname = "/";
  const err = url.searchParams.get("error");
  if (err) {
    dest.searchParams.set("gsc_error", err);
  } else {
    dest.searchParams.set("gsc_code", url.searchParams.get("code") ?? "");
    dest.searchParams.set("gsc_state", url.searchParams.get("state") ?? "");
  }
  return c.redirect(dest.toString(), 302);
});

/** Step 3 — SPA posts the code back; exchange for tokens and store (encrypted). */
gsc.post("/api/gsc/exchange", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const { code, state } = await c.req.json<{ code?: string; state?: string }>();
  if (!code || !(await verifyState(c.env, state))) {
    return c.json({ error: "בקשה לא תקינה" }, 400);
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GSC_CLIENT_ID!,
      client_secret: c.env.GSC_CLIENT_SECRET!,
      redirect_uri: redirectUri(c.req.raw),
      grant_type: "authorization_code",
    }),
  });
  const tok = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error_description?: string;
  };
  if (!res.ok || !tok.access_token) {
    return c.json({ error: tok.error_description || "חילוף ה-token נכשל" }, 500);
  }

  // Best-effort: fetch the connected Google account email for display.
  let email: string | null = null;
  try {
    const ui = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (ui.ok) email = ((await ui.json()) as { email?: string }).email ?? null;
  } catch {
    /* non-fatal */
  }

  const { data: userData } = await sb.auth.getUser();
  const adminId = userData.user?.id;
  if (!adminId) return c.json({ error: "unauthorized" }, 401);

  // Google only returns a refresh_token on first consent — preserve an existing one.
  let refreshEnc: string | null = null;
  if (tok.refresh_token) {
    refreshEnc = await encrypt(tok.refresh_token, c.env.ENCRYPTION_KEY!);
  } else {
    const { data: existing } = await sb
      .from("gsc_connections")
      .select("refresh_token_enc")
      .eq("admin_id", adminId)
      .maybeSingle();
    refreshEnc = (existing as { refresh_token_enc: string | null } | null)?.refresh_token_enc ?? null;
  }

  const { error } = await sb.from("gsc_connections").upsert(
    {
      admin_id: adminId,
      google_email: email,
      access_token_enc: await encrypt(tok.access_token, c.env.ENCRYPTION_KEY!),
      refresh_token_enc: refreshEnc,
      token_expiry: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      scope: tok.scope ?? SCOPES,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "admin_id" }
  );
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true, google_email: email });
});

/** Connection status for the current admin. */
gsc.get("/api/gsc/status", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const { data } = await sb.from("gsc_connections").select("google_email").limit(1);
  const conn = data?.[0] as { google_email: string | null } | undefined;
  return c.json({ connected: !!conn, google_email: conn?.google_email ?? null });
});

/** List the connected account's Search Console properties. */
gsc.get("/api/gsc/sites", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const at = await accessToken(c.env, sb);
  if (!at) return c.json({ error: "לא מחובר ל-Google Search Console" }, 400);

  const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${at.token}` },
  });
  if (!res.ok) return c.json({ error: "שליפת הנכסים נכשלה" }, 500);
  const body = (await res.json()) as {
    siteEntry?: { siteUrl: string; permissionLevel: string }[];
  };
  const sites = (body.siteEntry ?? [])
    .filter((s) => s.permissionLevel !== "siteUnverifiedUser")
    .map((s) => s.siteUrl);
  return c.json({ ok: true, sites });
});

/** Disconnect the current admin's GSC connection. */
gsc.post("/api/gsc/disconnect", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const { data: userData } = await sb.auth.getUser();
  if (userData.user?.id) {
    await sb.from("gsc_connections").delete().eq("admin_id", userData.user.id);
  }
  return c.json({ ok: true });
});

/** List the connected account's GA4 properties (Admin API). */
gsc.get("/api/gsc/ga-properties", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const at = await accessToken(c.env, sb);
  if (!at) return c.json({ error: "לא מחובר ל-Google" }, 400);

  const res = await fetch(
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200",
    { headers: { Authorization: `Bearer ${at.token}` } }
  );
  if (!res.ok) return c.json({ error: "שליפת נכסי Analytics נכשלה" }, 500);
  const body = (await res.json()) as {
    accountSummaries?: {
      displayName?: string;
      propertySummaries?: { property: string; displayName: string }[];
    }[];
  };
  const properties = (body.accountSummaries ?? []).flatMap((a) =>
    (a.propertySummaries ?? []).map((p) => ({
      property: p.property, // "properties/123456789"
      label: `${p.displayName}${a.displayName ? ` · ${a.displayName}` : ""}`,
    }))
  );
  return c.json({ ok: true, properties });
});

// ---- date helpers (last 28 days vs the 28 days before) ----
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function periods() {
  const DAY = 24 * 60 * 60 * 1000;
  const end = new Date();
  const curStart = new Date(end.getTime() - 27 * DAY);
  const prevEnd = new Date(end.getTime() - 28 * DAY);
  const prevStart = new Date(end.getTime() - 55 * DAY);
  return {
    curStart: fmtDate(curStart),
    curEnd: fmtDate(end),
    prevStart: fmtDate(prevStart),
    prevEnd: fmtDate(prevEnd),
  };
}

async function scQuery(
  token: string,
  property: string,
  body: Record<string, unknown>
): Promise<{ rows?: { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
      property
    )}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) return {};
  return res.json();
}

async function gaReport(
  token: string,
  property: string,
  body: Record<string, unknown>
): Promise<{ rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] }> {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return {};
  return res.json();
}

const ORGANIC_FILTER = {
  filter: {
    fieldName: "sessionDefaultChannelGroup",
    stringFilter: { matchType: "EXACT", value: "Organic Search" },
  },
};

/** Combined organic-traffic overview (Search Console + GA4) for the dashboard. */
gsc.get("/api/projects/:id/overview", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);

  const { data: proj } = await sb
    .from("projects")
    .select("gsc_property, ga_property")
    .eq("id", c.req.param("id"))
    .single();
  const gscProp = (proj as { gsc_property: string | null } | null)?.gsc_property;
  const gaProp = (proj as { ga_property: string | null } | null)?.ga_property;

  const at = await accessToken(c.env, sb);
  if (!at) return c.json({ connected: false });
  const token = at.token;
  const p = periods();

  // ---- Search Console (organic search performance) ----
  const gscPromise = (async () => {
    if (!gscProp) return null;
    const [cur, prev, series, top] = await Promise.all([
      scQuery(token, gscProp, { startDate: p.curStart, endDate: p.curEnd }),
      scQuery(token, gscProp, { startDate: p.prevStart, endDate: p.prevEnd }),
      scQuery(token, gscProp, { startDate: p.curStart, endDate: p.curEnd, dimensions: ["date"] }),
      scQuery(token, gscProp, {
        startDate: p.curStart,
        endDate: p.curEnd,
        dimensions: ["query"],
        rowLimit: 10,
      }),
    ]);
    const t = (r: typeof cur) => r.rows?.[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    return {
      property: gscProp,
      totals: t(cur),
      prev: t(prev),
      series: (series.rows ?? []).map((r) => ({
        date: r.keys?.[0] ?? "",
        clicks: r.clicks,
        impressions: r.impressions,
      })),
      topQueries: (top.rows ?? []).map((r) => ({
        query: r.keys?.[0] ?? "",
        clicks: r.clicks,
        impressions: r.impressions,
        position: r.position,
      })),
    };
  })();

  // ---- GA4 (organic-search sessions & users) ----
  const gaPromise = (async () => {
    if (!gaProp) return null;
    const [curSeries, prev] = await Promise.all([
      gaReport(token, gaProp, {
        dateRanges: [{ startDate: p.curStart, endDate: p.curEnd }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }],
        dimensionFilter: ORGANIC_FILTER,
        orderBys: [{ dimension: { dimensionName: "date" } }],
      }),
      gaReport(token, gaProp, {
        dateRanges: [{ startDate: p.prevStart, endDate: p.prevEnd }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }],
        dimensionFilter: ORGANIC_FILTER,
      }),
    ]);
    const series = (curSeries.rows ?? []).map((r) => ({
      date: r.dimensionValues?.[0]?.value ?? "",
      sessions: Number(r.metricValues?.[0]?.value ?? 0),
      users: Number(r.metricValues?.[1]?.value ?? 0),
    }));
    const totals = series.reduce(
      (acc, r) => ({ sessions: acc.sessions + r.sessions, users: acc.users + r.users }),
      { sessions: 0, users: 0 }
    );
    const prevRow = prev.rows?.[0];
    return {
      property: gaProp,
      totals,
      prev: {
        sessions: Number(prevRow?.metricValues?.[0]?.value ?? 0),
        users: Number(prevRow?.metricValues?.[1]?.value ?? 0),
      },
      series: series.map((r) => ({ date: r.date, sessions: r.sessions })),
    };
  })();

  const [gscData, gaData] = await Promise.all([gscPromise, gaPromise]);
  return c.json({ connected: true, gsc: gscData, ga: gaData });
});

/** Top search queries for a project's mapped property (last 90 days). */
gsc.get("/api/projects/:id/gsc/keywords", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);

  const { data: proj } = await sb
    .from("projects")
    .select("gsc_property")
    .eq("id", c.req.param("id"))
    .single();
  const property = (proj as { gsc_property: string | null } | null)?.gsc_property;
  if (!property) return c.json({ error: "לא הוגדר נכס Search Console לפרויקט" }, 400);

  const at = await accessToken(c.env, sb);
  if (!at) return c.json({ error: "לא מחובר ל-Google Search Console" }, 400);

  const end = new Date();
  const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
      property
    )}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${at.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: fmt(start),
        endDate: fmt(end),
        dimensions: ["query"],
        rowLimit: 100,
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    return c.json({ error: `שליפת מילות המפתח נכשלה: ${t.slice(0, 200)}` }, 500);
  }
  const body = (await res.json()) as {
    rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[];
  };
  const rows = (body.rows ?? []).map((r) => ({
    query: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));
  return c.json({ ok: true, rows });
});
