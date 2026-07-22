import { Hono } from "hono";
import type { Env } from "../index";
import { anonClient } from "../lib/companion";

/**
 * Endpoints called by the site's companion snippet (OUTBOUND from WordPress).
 * Authenticated by the per-project token via SECURITY DEFINER RPCs — no admin
 * JWT and no service-role key involved.
 */
export const companion = new Hono<{ Bindings: Env }>();

companion.post("/api/companion/health", async (c) => {
  const { token } = await c.req.json<{ token: string }>();
  const { data } = await anonClient(c.env).rpc("companion_health", { p_token: token });
  return c.json({ ok: data === true });
});

companion.post("/api/companion/claim", async (c) => {
  const { token, limit } = await c.req.json<{ token: string; limit?: number }>();
  const { data, error } = await anonClient(c.env).rpc("companion_claim", {
    p_token: token,
    p_limit: limit ?? 10,
  });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ jobs: data ?? [] });
});

companion.post("/api/companion/complete", async (c) => {
  const body = await c.req.json<{
    token: string;
    jobId: string;
    result?: unknown;
    error?: string;
  }>();
  const { data, error } = await anonClient(c.env).rpc("companion_complete", {
    p_token: body.token,
    p_job_id: body.jobId,
    p_result: body.result ?? null,
    p_error: body.error ?? null,
  });
  if (error) return c.json({ ok: false, error: error.message }, 500);
  return c.json({ ok: data === true });
});
