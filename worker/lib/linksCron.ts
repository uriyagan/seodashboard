import { createClient } from "@supabase/supabase-js";
import type { Env } from "../index";
import { decrypt } from "./crypto";
import { relayFrom } from "./project";
import { makeCompanionRunner } from "./companion";
import { refreshAllLinks } from "./links";
import type { WpAuth } from "./wordpress";

/**
 * Daily cron: refreshes the internal-links inventory of every active project.
 * Runs SEQUENTIALLY with per-project error isolation — one unreachable site
 * must not starve the others. Uses the service-role key (no user context).
 *
 * If the project count ever grows large, split the work across cron runs
 * (round-robin on the oldest links_synced_at) instead of doing all here.
 */
export async function refreshAllProjectsLinks(env: Env): Promise<void> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL || !env.ENCRYPTION_KEY) return;
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: projects } = await admin
    .from("projects")
    .select("id, site_url, wp_username, wp_app_password_encrypted")
    .eq("is_active", true);

  for (const p of projects ?? []) {
    if (!p.wp_username || !p.wp_app_password_encrypted) continue;
    try {
      const auth: WpAuth = {
        siteUrl: p.site_url,
        username: p.wp_username,
        appPassword: await decrypt(p.wp_app_password_encrypted, env.ENCRYPTION_KEY),
        relay: relayFrom(env),
      };
      const runner = makeCompanionRunner(admin, p.id);
      await refreshAllLinks(admin, p.id, p.site_url, auth, runner);
    } catch {
      // isolated — continue with the next project
    }
  }
}
