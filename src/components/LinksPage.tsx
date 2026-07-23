import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Link2,
  RefreshCw,
  Sparkles,
  Square,
  Unlink,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { useProjects } from "@/lib/projects";
import { Button, Card, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";
import type {
  LinkCheck,
  LinkOpportunity,
  LinkSourceType,
  LinksRefreshResponse,
  LinksScanResponse,
  SiteLink,
} from "@/lib/types";

const SOURCE_LABEL: Record<LinkSourceType, string> = {
  post: "פוסט",
  page: "עמוד",
  product: "מוצר",
  product_cat: "קטגוריית מוצר",
  product_tag: "תגית מוצר",
};

const PHASE_LABEL: Record<string, string> = {
  posts: "פוסטים",
  pages: "עמודים",
  products: "מוצרים",
  terms: "קטגוריות ותגיות",
};

const MAX_RENDERED_ROWS = 300;

function SourceBadge({ type }: { type: LinkSourceType }) {
  return (
    <span className="whitespace-nowrap rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--muted)]">
      {SOURCE_LABEL[type] ?? type}
    </span>
  );
}

function CheckBadge({ check }: { check?: LinkCheck }) {
  if (!check) return <span className="text-xs text-[var(--muted)]">—</span>;
  if (check.result === "ok")
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-xs text-[var(--muted)]">
        <Check className="size-3" /> תקין
      </span>
    );
  if (check.result === "broken")
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[var(--color-danger)] px-2.5 py-0.5 text-xs font-medium text-white">
        <Unlink className="size-3" /> שבור ({check.http_status})
      </span>
    );
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--muted)]"
      title={check.error ?? undefined}
    >
      <AlertTriangle className="size-3" /> שגיאה
    </span>
  );
}

/** Inline progress banner shown while a chunked loop runs. */
function ProgressBanner({ text, onStop }: { text: string; onStop: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)]">
      <div className="flex items-center gap-2">
        <Spinner className="size-4" />
        <span>{text}</span>
      </div>
      <button
        onClick={onStop}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
      >
        <Square className="size-3" />
        עצור
      </button>
    </div>
  );
}

type SubTab = "all" | "broken" | "opportunities";
type Busy = null | "refresh" | "check" | "scan";

export function LinksPage() {
  const { activeProject, reload: reloadProjects } = useProjects();
  const [tab, setTab] = useState<SubTab>("all");
  const [links, setLinks] = useState<SiteLink[]>([]);
  const [checks, setChecks] = useState<Map<string, LinkCheck>>(new Map());
  const [opps, setOpps] = useState<LinkOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [progressText, setProgressText] = useState("");
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const cancelRef = useRef(false);

  // Filters (inventory tab)
  const [fType, setFType] = useState<"all" | LinkSourceType>("all");
  const [fScope, setFScope] = useState<"all" | "internal" | "external">("all");
  const [fBroken, setFBroken] = useState(false);
  const [fSearch, setFSearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    setError(null);
    try {
      // site_links can be large — page through in 1000-row chunks.
      const all: SiteLink[] = [];
      for (let from = 0; from < 20_000; from += 1000) {
        const { data, error } = await supabase
          .from("site_links")
          .select("id, source_type, source_wp_id, source_title, source_url, target_url, anchor_text, is_internal")
          .eq("project_id", activeProject.id)
          .order("source_type")
          .order("source_wp_id")
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        all.push(...((data ?? []) as SiteLink[]));
        if (!data || data.length < 1000) break;
      }
      setLinks(all);

      const [{ data: checkRows }, { data: oppRows }] = await Promise.all([
        supabase
          .from("link_checks")
          .select("url, http_status, result, error, checked_at")
          .eq("project_id", activeProject.id),
        supabase
          .from("link_opportunities")
          .select("*")
          .eq("project_id", activeProject.id)
          .order("created_at", { ascending: false }),
      ]);
      setChecks(new Map(((checkRows ?? []) as LinkCheck[]).map((c) => [c.url, c])));
      setOpps((oppRows ?? []) as LinkOpportunity[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "טעינה נכשלה");
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Full inventory refresh — chunked loop against the worker. */
  async function refreshInventory() {
    if (!activeProject) return;
    setBusy("refresh");
    setError(null);
    cancelRef.current = false;
    try {
      let cursor: LinksRefreshResponse["cursor"] | undefined;
      let inserted = 0;
      for (let i = 0; i < 500 && !cancelRef.current; i++) {
        const r = await api<LinksRefreshResponse>(
          `/api/projects/${activeProject.id}/links/refresh`,
          { cursor }
        );
        inserted += r.progress.inserted;
        const label = PHASE_LABEL[r.progress.phase] ?? r.progress.phase;
        setProgressText(
          r.progress.totalPages > 1
            ? `סורק ${label} — עמוד ${r.progress.page} מתוך ${r.progress.totalPages} (${inserted} קישורים)`
            : `סורק ${label} (${inserted} קישורים)`
        );
        cursor = r.cursor;
        if (r.done) break;
      }
      await load();
      await reloadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : "רענון הקישורים נכשל");
    } finally {
      setBusy(null);
      setProgressText("");
    }
  }

  /** Broken-link check — frontend computes the distinct-URL worklist. */
  async function runBrokenCheck() {
    if (!activeProject) return;
    setBusy("check");
    setError(null);
    cancelRef.current = false;
    try {
      const distinct = [...new Set(links.map((l) => l.target_url))];
      const updated = new Map(checks);
      for (let i = 0; i < distinct.length && !cancelRef.current; i += 15) {
        const batch = distinct.slice(i, i + 15);
        const r = await api<{ ok: boolean; results: (LinkCheck & { url: string })[] }>(
          `/api/projects/${activeProject.id}/links/check`,
          { urls: batch }
        );
        for (const res of r.results) {
          updated.set(res.url, { ...res, checked_at: new Date().toISOString() });
        }
        setChecks(new Map(updated));
        setProgressText(
          `נבדקו ${Math.min(i + 15, distinct.length)} מתוך ${distinct.length} כתובות`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "בדיקת הקישורים נכשלה");
    } finally {
      setBusy(null);
      setProgressText("");
    }
  }

  /** AI opportunity scan — chunked loop. */
  async function runScan() {
    if (!activeProject) return;
    setBusy("scan");
    setError(null);
    cancelRef.current = false;
    try {
      let cursor: { offset: number } | undefined;
      for (let i = 0; i < 500 && !cancelRef.current; i++) {
        const r = await api<LinksScanResponse>(
          `/api/projects/${activeProject.id}/links/scan`,
          { cursor }
        );
        setProgressText(
          `נסרקו ${r.progress.index} מתוך ${r.progress.total} מקורות — נמצאו ${r.progress.found} הצעות בסבב זה`
        );
        cursor = r.cursor;
        if (r.done) break;
      }
      // Reload opportunities only (links unchanged by a scan).
      const { data } = await supabase
        .from("link_opportunities")
        .select("*")
        .eq("project_id", activeProject.id)
        .order("created_at", { ascending: false });
      setOpps((data ?? []) as LinkOpportunity[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "סריקת ה-AI נכשלה");
    } finally {
      setBusy(null);
      setProgressText("");
    }
  }

  async function applyOpp(o: LinkOpportunity) {
    if (!activeProject) return;
    setApplyingId(o.id);
    try {
      const r = await api<{ ok: boolean; error?: string }>(
        `/api/projects/${activeProject.id}/links/opportunities/${o.id}/apply`
      );
      setOpps((prev) =>
        prev.map((x) =>
          x.id === o.id
            ? r.ok
              ? { ...x, status: "applied", error: null, applied_at: new Date().toISOString() }
              : { ...x, status: "failed", error: r.error ?? "החלת הקישור נכשלה" }
            : x
        )
      );
      if (r.ok) {
        // The new link now exists on the site — reflect it in the inventory view.
        setLinks((prev) => [
          {
            id: `applied-${o.id}`,
            source_type: o.source_type,
            source_wp_id: o.source_wp_id,
            source_title: o.source_title,
            source_url: o.source_url,
            target_url: o.target_url,
            anchor_text: o.anchor_text,
            is_internal: true,
          },
          ...prev,
        ]);
      }
    } catch (e) {
      setOpps((prev) =>
        prev.map((x) =>
          x.id === o.id
            ? { ...x, status: "failed", error: e instanceof Error ? e.message : "שגיאה" }
            : x
        )
      );
    } finally {
      setApplyingId(null);
    }
  }

  async function dismissOpp(o: LinkOpportunity) {
    await supabase.from("link_opportunities").update({ status: "dismissed" }).eq("id", o.id);
    setOpps((prev) => prev.map((x) => (x.id === o.id ? { ...x, status: "dismissed" } : x)));
  }

  if (!activeProject) return null;

  // Derived
  const internal = links.filter((l) => l.is_internal);
  const brokenUrls = new Set(
    [...checks.values()].filter((c) => c.result === "broken").map((c) => c.url)
  );
  // Failed applies stay in the open list — the error is shown and retry is allowed.
  const openOpps = opps.filter((o) => o.status === "suggested" || o.status === "failed");
  const historyOpps = opps.filter((o) => o.status === "applied" || o.status === "dismissed");

  const filtered = links.filter((l) => {
    if (fType !== "all" && l.source_type !== fType) return false;
    if (fScope === "internal" && !l.is_internal) return false;
    if (fScope === "external" && l.is_internal) return false;
    if (fBroken && !brokenUrls.has(l.target_url)) return false;
    if (fSearch) {
      const q = fSearch.toLowerCase();
      if (
        !l.anchor_text.toLowerCase().includes(q) &&
        !l.target_url.toLowerCase().includes(q) &&
        !l.source_title.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const brokenLinks = links.filter((l) => brokenUrls.has(l.target_url));
  const errorChecks = [...checks.values()].filter((c) => c.result === "error");

  const stats = [
    { label: "סה\"כ קישורים", value: links.length },
    { label: "פנימיים", value: internal.length },
    { label: "חיצוניים", value: links.length - internal.length },
    { label: "שבורים", value: brokenUrls.size },
    { label: "הזדמנויות פתוחות", value: openOpps.length },
  ];

  const selectCls =
    "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none";

  return (
    <div className="p-5 sm:p-8 lg:p-[60px]">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">קישורים פנימיים</h1>
          <p className="text-sm text-[var(--muted)]">
            {activeProject.links_synced_at
              ? `עודכן לאחרונה: ${new Date(activeProject.links_synced_at).toLocaleString("he-IL")}`
              : "טרם בוצע סנכרון קישורים"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={refreshInventory} loading={busy === "refresh"} disabled={busy !== null}>
            {busy !== "refresh" && <RefreshCw className="size-4" />}
            רענון קישורים
          </Button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-[var(--color-danger)]">{error}</p>}
      {busy && progressText && (
        <ProgressBanner text={progressText} onStop={() => (cancelRef.current = true)} />
      )}

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs text-[var(--muted)]">{s.label}</p>
            <p className="mt-1 text-xl font-semibold text-[var(--text)]">
              {loading ? "…" : s.value}
            </p>
          </Card>
        ))}
      </div>

      {/* Sub-tabs */}
      <div className="mb-4 flex gap-1 border-b border-[var(--border)]">
        {(
          [
            { key: "all", label: "כל הקישורים" },
            { key: "broken", label: "קישורים שבורים" },
            { key: "opportunities", label: `הזדמנויות קישור${openOpps.length ? ` (${openOpps.length})` : ""}` },
          ] as { key: SubTab; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-[var(--brand)] text-[var(--text)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ---- Inventory tab ---- */}
      {tab === "all" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select value={fType} onChange={(e) => setFType(e.target.value as typeof fType)} className={selectCls}>
              <option value="all">כל המקורות</option>
              {Object.entries(SOURCE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select value={fScope} onChange={(e) => setFScope(e.target.value as typeof fScope)} className={selectCls}>
              <option value="all">פנימיים + חיצוניים</option>
              <option value="internal">פנימיים בלבד</option>
              <option value="external">חיצוניים בלבד</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-[var(--text)]">
              <input
                type="checkbox"
                checked={fBroken}
                onChange={(e) => setFBroken(e.target.checked)}
                className="size-4 accent-[var(--brand)]"
              />
              שבורים בלבד
            </label>
            <input
              value={fSearch}
              onChange={(e) => setFSearch(e.target.value)}
              placeholder="חיפוש עוגן / כתובת / מקור…"
              className={cn(selectCls, "min-w-[200px] flex-1 sm:flex-none")}
            />
          </div>

          <Card className="overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Spinner className="size-6" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <Link2 className="size-8 text-[var(--muted)]" />
                <p className="text-sm text-[var(--muted)]">
                  {links.length === 0
                    ? "אין קישורים במלאי עדיין — לחץ \"רענון קישורים\" כדי לסרוק את האתר."
                    : "אין קישורים התואמים את הסינון."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-right text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                      <th className="px-4 py-3 font-medium">מקור</th>
                      <th className="px-4 py-3 font-medium">עוגן</th>
                      <th className="px-4 py-3 font-medium">כתובת יעד</th>
                      <th className="px-4 py-3 font-medium">סוג</th>
                      <th className="px-4 py-3 font-medium">בדיקה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, MAX_RENDERED_ROWS).map((l) => (
                      <tr key={l.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                        <td className="max-w-[220px] px-4 py-3">
                          <div className="flex items-center gap-2">
                            <SourceBadge type={l.source_type} />
                            <span className="truncate text-[var(--text)]" title={l.source_title}>
                              {l.source_title || "—"}
                            </span>
                          </div>
                        </td>
                        <td className="max-w-[200px] truncate px-4 py-3 font-medium text-[var(--text)]" title={l.anchor_text}>
                          {l.anchor_text || <span className="text-[var(--muted)]">(תמונה/ריק)</span>}
                        </td>
                        <td className="max-w-[280px] px-4 py-3" dir="ltr">
                          <a
                            href={l.target_url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-[var(--muted)] hover:text-[var(--text)] hover:underline"
                            title={l.target_url}
                          >
                            {l.target_url}
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs",
                              l.is_internal
                                ? "bg-[var(--brand)] text-[var(--brand-fg)]"
                                : "border border-[var(--border)] text-[var(--muted)]"
                            )}
                          >
                            {l.is_internal ? "פנימי" : "חיצוני"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <CheckBadge check={checks.get(l.target_url)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length > MAX_RENDERED_ROWS && (
                  <p className="border-t border-[var(--border)] px-4 py-3 text-center text-xs text-[var(--muted)]">
                    מוצגים {MAX_RENDERED_ROWS} מתוך {filtered.length} — השתמש בסינון או בחיפוש לצמצום.
                  </p>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      {/* ---- Broken tab ---- */}
      {tab === "broken" && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-[var(--muted)]">
              בדיקה ידנית של כל הקישורים במלאי ({[...new Set(links.map((l) => l.target_url))].length} כתובות ייחודיות).
              קישורים פנימיים נבדקים דרך ה-relay.
            </p>
            <Button onClick={runBrokenCheck} loading={busy === "check"} disabled={busy !== null || links.length === 0}>
              {busy !== "check" && <Unlink className="size-4" />}
              בדיקת קישורים שבורים
            </Button>
          </div>

          <Card className="overflow-hidden">
            {brokenLinks.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <Check className="size-8 text-[var(--muted)]" />
                <p className="text-sm text-[var(--muted)]">
                  {checks.size === 0
                    ? "טרם בוצעה בדיקה. לחץ \"בדיקת קישורים שבורים\" כדי להתחיל."
                    : "לא נמצאו קישורים שבורים 🎉"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-right text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                      <th className="px-4 py-3 font-medium">כתובת שבורה</th>
                      <th className="px-4 py-3 font-medium">סטטוס</th>
                      <th className="px-4 py-3 font-medium">עוגן</th>
                      <th className="px-4 py-3 font-medium">נמצא ב־</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brokenLinks.map((l) => (
                      <tr key={l.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                        <td className="max-w-[300px] px-4 py-3" dir="ltr">
                          <span className="block truncate text-[var(--text)]" title={l.target_url}>
                            {l.target_url}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <CheckBadge check={checks.get(l.target_url)} />
                        </td>
                        <td className="max-w-[180px] truncate px-4 py-3 text-[var(--text)]">
                          {l.anchor_text || "—"}
                        </td>
                        <td className="max-w-[220px] px-4 py-3">
                          <div className="flex items-center gap-2">
                            <SourceBadge type={l.source_type} />
                            <a
                              href={l.source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="truncate text-[var(--muted)] hover:text-[var(--text)] hover:underline"
                              title={l.source_title}
                            >
                              {l.source_title || l.source_url}
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {errorChecks.length > 0 && (
            <p className="mt-3 text-xs text-[var(--muted)]">
              {errorChecks.length} כתובות החזירו שגיאה שאינה "שבור" (חסימת בוטים, timeout וכו') — לא נספרות כשבורות.
            </p>
          )}
        </>
      )}

      {/* ---- Opportunities tab ---- */}
      {tab === "opportunities" && (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--muted)]">
              סריקת AI של פוסטים, עמודים וקטגוריות למציאת הזדמנויות קישור פנימי חדשות.
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="text-xs text-[var(--muted)] underline-offset-2 hover:underline"
              >
                {showHistory ? "הסתר היסטוריה" : `היסטוריה (${historyOpps.length})`}
              </button>
              <Button onClick={runScan} loading={busy === "scan"} disabled={busy !== null}>
                {busy !== "scan" && <Sparkles className="size-4" />}
                סריקת AI
              </Button>
            </div>
          </div>

          {openOpps.length === 0 && !showHistory ? (
            <Card className="flex flex-col items-center gap-2 py-16 text-center">
              <Sparkles className="size-8 text-[var(--muted)]" />
              <p className="text-sm text-[var(--muted)]">
                אין הצעות פתוחות. הרץ "סריקת AI" כדי למצוא הזדמנויות קישור חדשות.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {(showHistory ? [...openOpps, ...historyOpps] : openOpps).map((o) => (
                <Card key={o.id} className={cn("p-4", o.status !== "suggested" && "opacity-70")}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
                        <SourceBadge type={o.source_type} />
                        <span className="truncate font-medium text-[var(--text)]" title={o.source_title}>
                          {o.source_title}
                        </span>
                        <span className="text-[var(--muted)]">←</span>
                        <span className="truncate text-[var(--text)]" title={o.target_title}>
                          {o.target_title || o.target_url}
                        </span>
                        <a
                          href={o.target_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--muted)] hover:text-[var(--text)]"
                          title={o.target_url}
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      </div>
                      <p className="text-sm text-[var(--text)]">
                        עוגן: <mark className="rounded bg-[var(--brand-soft)] px-1 text-[var(--text)]">{o.anchor_text}</mark>
                      </p>
                      {o.reason && <p className="mt-1 text-xs text-[var(--muted)]">{o.reason}</p>}
                      {o.status === "failed" && o.error && (
                        <p className="mt-1 text-xs text-[var(--color-danger)]">{o.error}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {o.status === "suggested" || o.status === "failed" ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => void applyOpp(o)}
                            loading={applyingId === o.id}
                            disabled={applyingId !== null}
                          >
                            {applyingId !== o.id && <Check className="size-4" />}
                            החל קישור
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void dismissOpp(o)} disabled={applyingId !== null}>
                            <X className="size-4" />
                            דחה
                          </Button>
                        </>
                      ) : (
                        <span className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--muted)]">
                          {o.status === "applied" ? "הוחל ✓" : "נדחה"}
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
