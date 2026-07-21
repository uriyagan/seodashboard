import { Hono } from "hono";
import { projects } from "./routes/projects";
import { posts } from "./routes/posts";
import { ai } from "./routes/ai";
import { ideas } from "./routes/ideas";
import { requireAdmin } from "./lib/supabase";
import { runMonitor } from "./lib/monitor";

/**
 * Cloudflare Worker — API layer (Hono) + daily cron monitor.
 * Only /api/* requests reach the fetch handler (see wrangler.jsonc
 * `run_worker_first`); all other paths are served from static assets (the SPA).
 */
export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_TEXT_MODEL?: string;
  GEMINI_IMAGE_MODEL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  ADMIN_EMAILS?: string;
  ENCRYPTION_KEY?: string;
  APP_URL?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Health check.
app.get("/api/health", (c) =>
  c.json({ ok: true, service: "seo-dashboard-api", ts: new Date().toISOString() })
);

// Feature routes.
app.route("/", projects); // Phase 2 — WordPress connect + sync
app.route("/", posts); // Phase 3 — post fetch/push, terms, media
app.route("/", ai); // Phase 4–5 — Gemini text + Nano Banana 2 images
app.route("/", ideas); // Phase 6 — idea engine

// Manual trigger for the monitor (admins only) — same logic the cron runs.
app.post("/api/monitor/run", async (c) => {
  const sb = await requireAdmin(c.env, c.req.raw);
  if (!sb) return c.json({ error: "unauthorized" }, 401);
  const result = await runMonitor(c.env);
  return c.json(result);
});

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  // Phase 7 — daily cadence & stuck-draft monitoring.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runMonitor(env).then(() => undefined));
  },
};
