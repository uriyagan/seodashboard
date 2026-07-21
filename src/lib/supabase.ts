import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  // Surfaced clearly during development if env vars are missing.
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY");
}

/**
 * "Remember me" storage adapter.
 * When the flag is set → localStorage (session persists across browser restarts).
 * When unset → sessionStorage (session cleared when the tab closes).
 */
const REMEMBER_KEY = "seo_dash_remember";

export function setRemember(remember: boolean) {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? "true" : "false");
  } catch {
    /* ignore */
  }
}

const hybridStorage = {
  getItem(key: string): string | null {
    const remember = localStorage.getItem(REMEMBER_KEY) !== "false";
    return (remember ? localStorage : sessionStorage).getItem(key);
  },
  setItem(key: string, value: string): void {
    const remember = localStorage.getItem(REMEMBER_KEY) !== "false";
    (remember ? localStorage : sessionStorage).setItem(key, value);
  },
  removeItem(key: string): void {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: hybridStorage,
  },
});
