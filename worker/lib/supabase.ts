import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../index";

/**
 * Creates a Supabase client scoped to the caller's access token, so all
 * database operations run under Row Level Security (admins-only policies).
 */
export function userClient(env: Env, token: string): SupabaseClient {
  return createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Extracts the Bearer token from the Authorization header. */
export function getToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

/**
 * Verifies the caller is an authenticated, allow-listed admin.
 * Returns a token-scoped client on success, or null if unauthorized.
 */
export async function requireAdmin(
  env: Env,
  req: Request
): Promise<SupabaseClient | null> {
  const token = getToken(req);
  if (!token) return null;
  const sb = userClient(env, token);
  const { data, error } = await sb.rpc("is_admin");
  if (error || data !== true) return null;
  return sb;
}
