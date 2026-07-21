import { createClient } from "@supabase/supabase-js";
import type { Env } from "../index";
import { sendEmail, adminRecipients, emailTemplate } from "./resend";

/**
 * Daily cron job: checks each active project's publishing cadence and
 * flags stuck drafts, then emails the admins a summary.
 * Uses the service-role key (no user context in a cron run).
 */
export async function runMonitor(env: Env): Promise<{ ok: boolean; issues: number; error?: string }> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL) {
    return { ok: false, issues: 0, error: "SUPABASE_SERVICE_ROLE_KEY not configured" };
  }
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: projects, error } = await admin
    .from("projects")
    .select("id, name, cadence_per_week, stuck_draft_days, last_post_at")
    .eq("is_active", true);
  if (error) return { ok: false, issues: 0, error: error.message };

  const now = Date.now();
  const overdue: string[] = [];
  const stuck: string[] = [];

  for (const p of projects ?? []) {
    // Cadence: expected interval in days between posts.
    const intervalDays = 7 / Math.max(1, p.cadence_per_week || 1);
    const last = p.last_post_at ? new Date(p.last_post_at).getTime() : 0;
    const daysSince = last ? (now - last) / 86_400_000 : Infinity;
    if (daysSince > intervalDays) {
      overdue.push(
        `<li><b>${p.name}</b> — ${
          last ? `לא הועלה פוסט כבר ${Math.floor(daysSince)} ימים` : "עדיין לא הועלה פוסט"
        }</li>`
      );
    }

    // Stuck drafts: draft posts pushed but not published for > stuck_draft_days.
    const cutoff = new Date(now - (p.stuck_draft_days || 3) * 86_400_000).toISOString();
    const { count } = await admin
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("project_id", p.id)
      .eq("wp_status", "draft")
      .not("pushed_at", "is", null)
      .lt("pushed_at", cutoff);
    if (count && count > 0) {
      stuck.push(`<li><b>${p.name}</b> — ${count} טיוטות ממתינות לפרסום מעל ${p.stuck_draft_days} ימים</li>`);
    }
  }

  const issues = overdue.length + stuck.length;
  if (issues === 0) return { ok: true, issues: 0 };

  const parts: string[] = [];
  if (overdue.length) parts.push(`<h3 style="margin:16px 0 6px">פרויקטים שלא הועלה בהם פוסט בקצב</h3><ul>${overdue.join("")}</ul>`);
  if (stuck.length) parts.push(`<h3 style="margin:16px 0 6px">טיוטות תקועות (נוצרו אך לא פורסמו)</h3><ul>${stuck.join("")}</ul>`);
  const html = emailTemplate("סיכום ניטור יומי", parts.join(""));

  const result = await sendEmail(env, {
    to: adminRecipients(env),
    subject: `SEO Dashboard — ${issues} התראות ניטור`,
    html,
  });
  return { ok: result.ok, issues, error: result.error };
}
