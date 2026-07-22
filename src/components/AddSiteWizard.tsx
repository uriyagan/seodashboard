import { useState, type FormEvent } from "react";
import {
  Check,
  ChevronLeft,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  PartyPopper,
  ShieldAlert,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useProjects } from "@/lib/projects";
import { Alert, Button, Input, Label } from "@/components/ui";
import { CompanionSnippet } from "@/components/CompanionSnippet";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4 | 5;

const STEPS = ["כתובת", "התחברות", "סנכרון"];

export function AddSiteWizard({ onClose }: { onClose: () => void }) {
  const { reload, setActiveId } = useProjects();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [name, setName] = useState("");
  const [wpUser, setWpUser] = useState<string | null>(null);
  const [yoast, setYoast] = useState(false);
  const [firewalled, setFirewalled] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [companionToken, setCompanionToken] = useState("");
  const [summary, setSummary] = useState<{ posts: number; categories: number; tags: number } | null>(null);

  const cleanUrl = url.trim().replace(/\/+$/, "");

  async function checkUrl(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api<{ ok: boolean; error?: string }>("/api/projects/check-url", {
        url: cleanUrl,
      });
      if (!r.ok) throw new Error(r.error || "האתר לא נמצא או שה-REST חסום");
      if (!name) {
        try {
          setName(new URL(cleanUrl).hostname.replace(/^www\./, ""));
        } catch { /* ignore */ }
      }
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "בדיקה נכשלה");
    } finally {
      setLoading(false);
    }
  }

  async function testConn(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api<{
        ok: boolean;
        user?: string;
        yoast?: boolean;
        firewalled?: boolean;
        error?: string;
      }>("/api/projects/test-connection", {
        url: cleanUrl,
        username: username.trim(),
        appPassword: appPassword.trim(),
      });
      if (!r.ok) throw new Error(r.error || "אימות נכשל");
      setFirewalled(Boolean(r.firewalled));
      setWpUser(r.firewalled ? null : r.user ?? username);
      setYoast(Boolean(r.yoast));
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "בדיקה נכשלה");
    } finally {
      setLoading(false);
    }
  }

  async function connectAndSync(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api<{
        ok: boolean;
        projectId?: string;
        firewalled?: boolean;
        companionToken?: string;
        posts?: number;
        categories?: number;
        tags?: number;
        error?: string;
        warning?: string;
      }>("/api/projects/connect", {
        name: name.trim(),
        url: cleanUrl,
        username: username.trim(),
        appPassword: appPassword.trim(),
      });
      if (!r.ok) throw new Error(r.error || "החיבור נכשל");
      await reload();
      if (r.projectId) {
        setProjectId(r.projectId);
        setActiveId(r.projectId);
      }
      if (r.firewalled) {
        setCompanionToken(r.companionToken ?? "");
        setStep(5); // install the companion snippet, then sync
        return;
      }
      setSummary({ posts: r.posts ?? 0, categories: r.categories ?? 0, tags: r.tags ?? 0 });
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "החיבור נכשל");
    } finally {
      setLoading(false);
    }
  }

  async function syncAfterCompanion() {
    setError(null);
    setLoading(true);
    try {
      const r = await api<{
        ok: boolean;
        posts?: number;
        categories?: number;
        tags?: number;
        error?: string;
      }>(`/api/projects/${projectId}/sync`);
      if (!r.ok) throw new Error(r.error || "הסנכרון נכשל");
      setSummary({ posts: r.posts ?? 0, categories: r.categories ?? 0, tags: r.tags ?? 0 });
      await reload();
      setStep(4);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "הסנכרון נכשל — ודא שהסניפט הודבק ושה-cron פועל, ונסה שוב"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-lg font-bold text-[var(--text)]">הוספת אתר חדש</h2>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)]"
            aria-label="סגירה"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Stepper */}
        {step < 4 && (
          <div className="flex items-center gap-2 px-6 pt-5">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const done = step > n;
              const current = step === n;
              return (
                <div key={label} className="flex flex-1 items-center gap-2">
                  <div
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      done && "bg-[var(--brand)] text-white",
                      current && "bg-[var(--brand-soft)] text-[var(--brand)] ring-2 ring-[var(--brand)]",
                      !done && !current && "bg-[var(--surface-2)] text-[var(--muted)]"
                    )}
                  >
                    {done ? <Check className="size-4" /> : n}
                  </div>
                  <span
                    className={cn(
                      "text-sm font-medium",
                      current || done ? "text-[var(--text)]" : "text-[var(--muted)]"
                    )}
                  >
                    {label}
                  </span>
                  {n < STEPS.length && <div className="h-px flex-1 bg-[var(--border)]" />}
                </div>
              );
            })}
          </div>
        )}

        <div className="p-6">
          {error && (
            <div className="mb-4">
              <Alert>{error}</Alert>
            </div>
          )}

          {/* Step 1 — URL */}
          {step === 1 && (
            <form onSubmit={checkUrl} className="space-y-4">
              <div>
                <Label htmlFor="w-url">כתובת אתר ה-WordPress</Label>
                <div className="relative">
                  <Globe className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[var(--muted)]" />
                  <Input
                    id="w-url"
                    type="url"
                    dir="ltr"
                    className="pr-9"
                    placeholder="https://example.com"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <p className="mt-1.5 text-xs text-[var(--muted)]">
                  נבדוק שממשק ה-REST של האתר זמין (/wp-json).
                </p>
              </div>
              <Button type="submit" className="w-full" loading={loading}>
                בדיקת האתר
              </Button>
            </form>
          )}

          {/* Step 2 — Auth */}
          {step === 2 && (
            <form onSubmit={testConn} className="space-y-4">
              <div>
                <Label htmlFor="w-user">שם משתמש (Admin)</Label>
                <Input
                  id="w-user"
                  dir="ltr"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="w-pass">Application Password</Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[var(--muted)]" />
                  <Input
                    id="w-pass"
                    dir="ltr"
                    className="pr-9"
                    placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                    value={appPassword}
                    onChange={(e) => setAppPassword(e.target.value)}
                    required
                  />
                </div>
                <a
                  href={`${cleanUrl}/wp-admin/profile.php`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline"
                >
                  איך יוצרים Application Password?
                  <ExternalLink className="size-3" />
                </a>
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1" loading={loading}>
                  בדיקת התחברות
                </Button>
                <Button type="button" variant="outline" onClick={() => setStep(1)}>
                  <ChevronLeft className="size-4" />
                  חזרה
                </Button>
              </div>
            </form>
          )}

          {/* Step 3 — Confirm + sync */}
          {step === 3 && (
            <form onSubmit={connectAndSync} className="space-y-4">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm">
                {firewalled ? (
                  <div className="flex items-start gap-2 text-[var(--text)]">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" />
                    <span>
                      האתר מאחורי חומת אש (SiteGround) שחוסמת גישה ישירה. בשלב הבא נחבר
                      אותו דרך סניפט ה-companion.
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-[var(--text)]">
                      <Check className="size-4 text-[var(--color-success)]" />
                      מחובר כ־<span dir="ltr" className="font-medium">{wpUser}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[var(--muted)]">
                      {yoast ? (
                        <>
                          <Check className="size-4 text-[var(--color-success)]" />
                          Yoast SEO זוהה באתר
                        </>
                      ) : (
                        <span>Yoast SEO לא זוהה — כתיבת שדות SEO תדרוש את הסניפט.</span>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div>
                <Label htmlFor="w-name">שם הפרויקט</Label>
                <Input
                  id="w-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <p className="text-xs text-[var(--muted)]">
                בלחיצה נסנכרן מיד את כל הפוסטים, הקטגוריות והתגיות מהאתר.
              </p>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1" loading={loading}>
                  {loading ? "מסנכרן…" : "חבר וסנכרן"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(2)}
                  disabled={loading}
                >
                  <ChevronLeft className="size-4" />
                  חזרה
                </Button>
              </div>
              {loading && (
                <div className="flex items-center justify-center gap-2 pt-1 text-sm text-[var(--muted)]">
                  <Loader2 className="size-4 animate-spin" />
                  מושך נתונים מהאתר, רגע…
                </div>
              )}
            </form>
          )}

          {/* Step 5 — Companion install (firewalled sites) */}
          {step === 5 && (
            <div className="space-y-4">
              <CompanionSnippet token={companionToken} />
              <div className="flex gap-2">
                <Button className="flex-1" onClick={syncAfterCompanion} loading={loading}>
                  {loading ? "מסנכרן…" : "הדבקתי — סנכרן עכשיו"}
                </Button>
                <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
                  אעשה זאת אחר כך
                </Button>
              </div>
              {loading && (
                <div className="flex items-center justify-center gap-2 text-sm text-[var(--muted)]">
                  <Loader2 className="size-4 animate-spin" />
                  ממתין שהאתר יריץ את המשימה (עד דקה)…
                </div>
              )}
            </div>
          )}

          {/* Step 4 — Done */}
          {step === 4 && summary && (
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-950/50">
                <PartyPopper className="size-7" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--text)]">האתר חובר בהצלחה!</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  נסנכרנו {summary.posts} פוסטים · {summary.categories} קטגוריות · {summary.tags} תגיות
                </p>
              </div>
              <Button className="w-full" onClick={onClose}>
                מעולה, בוא נתחיל
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
