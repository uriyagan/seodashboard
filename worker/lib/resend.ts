/** Resend email client (runs in the Worker). */
import type { Env } from "../index";

export async function sendEmail(
  env: Env,
  opts: { to: string[]; subject: string; html: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY not configured" };
  const from = env.RESEND_FROM || "SEO Dashboard <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `Resend ${res.status}: ${detail.slice(0, 200)}` };
  }
  return { ok: true };
}

/** Returns the admin recipient list from env (comma-separated). */
export function adminRecipients(env: Env): string[] {
  return (env.ADMIN_EMAILS || "info@uriyaganor.com,sam@uriyaganor.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Simple RTL Hebrew email wrapper. */
export function emailTemplate(title: string, bodyHtml: string): string {
  return `<!doctype html><html dir="rtl" lang="he"><body style="font-family:Arial,sans-serif;background:#f7f8fa;padding:24px;margin:0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e7ec;border-radius:14px;overflow:hidden">
    <div style="background:#6c5ce7;color:#fff;padding:16px 24px;font-size:18px;font-weight:bold">SEO Dashboard</div>
    <div style="padding:24px;color:#101828">
      <h2 style="margin:0 0 12px;font-size:18px">${title}</h2>
      ${bodyHtml}
    </div>
  </div></body></html>`;
}
