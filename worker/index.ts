import { Hono } from "hono";
import { projects } from "./routes/projects";

/**
 * Cloudflare Worker — API layer (Hono).
 * Only /api/* requests reach this worker (see wrangler.jsonc `run_worker_first`).
 * All other paths are served directly from static assets (the React SPA).
 *
 * Secrets are injected as environment bindings in production
 * (SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, RESEND_API_KEY, ENCRYPTION_KEY).
 */
export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GEMINI_API_KEY?: string;
  RESEND_API_KEY?: string;
  ENCRYPTION_KEY?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Health check — verifies the API is reachable.
app.get("/api/health", (c) =>
  c.json({ ok: true, service: "seo-dashboard-api", ts: new Date().toISOString() })
);

// Phase 2 — WordPress connection, add-site wizard, sync.
app.route("/", projects);

// Placeholder groups — implemented in later phases:
//   /api/ai/*         — Gemini text + Nano Banana 2 images (Phase 4–5)
//   /api/ideas/*      — idea engine (Phase 6)
//   /api/notify/*     — Resend + cron monitoring (Phase 7)

// Fallback for any unmatched /api route.
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// Safety net: if a non-API request ever reaches the worker, serve assets.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
