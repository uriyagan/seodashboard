import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../index";

/**
 * Companion job queue helpers. When a site's host firewall blocks all inbound
 * datacenter requests, WordPress operations are enqueued here; the site's
 * companion snippet polls OUTBOUND, runs them locally, and posts results back.
 */

export interface CompanionRequest {
  method: string;
  route: string; // WP REST route, e.g. "/wp/v2/posts"
  query?: Record<string, string | number>;
  body?: unknown;
}

export interface CompanionResult {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

export type CompanionRunner = (req: CompanionRequest) => Promise<CompanionResult>;

/** Anon-key Supabase client (used by token-authenticated companion RPCs). */
export function anonClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const POLL_MS = 700;

/**
 * Returns a runner that enqueues a job (via the admin-scoped client) and waits
 * (bounded) for the companion to complete it. Throws on failure/timeout.
 */
export function makeCompanionRunner(
  sb: SupabaseClient,
  projectId: string,
  timeoutMs = 24_000
): CompanionRunner {
  return async (req) => {
    const { data, error } = await sb
      .from("companion_jobs")
      .insert({ project_id: projectId, request: req, status: "queued" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`enqueue failed: ${error?.message ?? "unknown"}`);
    const id = (data as { id: string }).id;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const { data: row } = await sb
        .from("companion_jobs")
        .select("status, result, error")
        .eq("id", id)
        .maybeSingle();
      if (!row) continue;
      const j = row as { status: string; result: CompanionResult | null; error: string | null };
      if (j.status === "failed") throw new Error(j.error || "companion job failed");
      if (j.status === "done") return j.result ?? { status: 200, body: null };
    }
    throw new Error(
      "companion timeout — the site's companion snippet hasn't run the job yet (check the snippet is installed and cron is firing)"
    );
  };
}
