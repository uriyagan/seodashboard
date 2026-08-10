import { supabase } from "./supabase";

/** Calls a Worker /api endpoint with the current user's access token. */
export async function api<T = unknown>(
  path: string,
  body?: unknown,
  method: "GET" | "POST" = "POST"
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text().catch(() => "");
  let json = {} as T & { error?: string };
  try {
    json = raw ? (JSON.parse(raw) as T & { error?: string }) : ({} as T & { error?: string });
  } catch {
    /* non-JSON body (e.g. Cloudflare 524 plain text) */
  }
  if (!res.ok) {
    if (json.error) throw new Error(json.error);
    if (res.status === 524 || /error code:\s*524/i.test(raw)) {
      throw new Error(
        "הבקשה לקחה יותר מדי זמן (Cloudflare 524). נסה שוב — יצירת פוסט ארוכה עם Gemini Pro עלולה לעבור את מגבלת ה-~100 שניות."
      );
    }
    throw new Error(`HTTP ${res.status}`);
  }
  return json as T;
}
