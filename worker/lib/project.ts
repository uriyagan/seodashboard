import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../index";
import { decrypt } from "./crypto";
import type { WpAuth } from "./wordpress";

export interface ProjectRow {
  id: string;
  name: string;
  site_url: string;
  wp_username: string | null;
  wp_app_password_encrypted: string | null;
  content_prompt: string;
  image_prompt: string;
  keywords: string[];
  cadence_per_week: number;
  stuck_draft_days: number;
  last_post_at: string | null;
}

/** Loads a project row (RLS-scoped) by id. */
export async function loadProject(
  sb: SupabaseClient,
  projectId: string
): Promise<ProjectRow | null> {
  const { data, error } = await sb
    .from("projects")
    .select(
      "id, name, site_url, wp_username, wp_app_password_encrypted, content_prompt, image_prompt, keywords, cadence_per_week, stuck_draft_days, last_post_at"
    )
    .eq("id", projectId)
    .single();
  if (error || !data) return null;
  return data as ProjectRow;
}

/** Builds decrypted WordPress auth from a project row. */
export async function projectAuth(env: Env, project: ProjectRow): Promise<WpAuth> {
  if (!project.wp_app_password_encrypted || !project.wp_username) {
    throw new Error("לפרויקט אין פרטי חיבור WordPress");
  }
  return {
    siteUrl: project.site_url,
    username: project.wp_username,
    appPassword: await decrypt(project.wp_app_password_encrypted, env.ENCRYPTION_KEY!),
  };
}
