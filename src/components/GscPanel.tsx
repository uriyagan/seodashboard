import { useEffect, useState } from "react";
import { Link2, Plus, Search, Unlink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { useProjects } from "@/lib/projects";
import type { Project } from "@/lib/types";
import { Alert, Button, Spinner } from "@/components/ui";

interface Row {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export function GscPanel({
  project,
  keywords,
  onAddKeyword,
}: {
  project: Project;
  keywords: string[];
  onAddKeyword: (kw: string) => void;
}) {
  const { reload } = useProjects();
  const [status, setStatus] = useState<{ connected: boolean; google_email: string | null } | null>(
    null
  );
  const [sites, setSites] = useState<string[]>([]);
  const [gaProps, setGaProps] = useState<{ property: string; label: string }[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<null | "connect" | "keywords" | "property" | "ga">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ connected: boolean; google_email: string | null }>("/api/gsc/status", undefined, "GET")
      .then(setStatus)
      .catch(() => setStatus({ connected: false, google_email: null }));
  }, []);

  // Once connected, load the account's Search Console + GA4 properties.
  useEffect(() => {
    if (!status?.connected) return;
    api<{ sites: string[] }>("/api/gsc/sites", undefined, "GET")
      .then((r) => setSites(r.sites))
      .catch((e) => setError(e.message));
    api<{ properties: { property: string; label: string }[] }>(
      "/api/gsc/ga-properties",
      undefined,
      "GET"
    )
      .then((r) => setGaProps(r.properties))
      .catch(() => {});
  }, [status?.connected]);

  async function connect() {
    setBusy("connect");
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/api/gsc/authorize", undefined, "GET");
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "החיבור נכשל");
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!confirm("לנתק את החיבור ל-Google Search Console?")) return;
    await api("/api/gsc/disconnect");
    setStatus({ connected: false, google_email: null });
    setRows(null);
    setSites([]);
  }

  async function setProperty(property: string) {
    setBusy("property");
    setError(null);
    const { error } = await supabase
      .from("projects")
      .update({ gsc_property: property || null })
      .eq("id", project.id);
    if (error) setError(error.message);
    else {
      await reload();
      setRows(null);
    }
    setBusy(null);
  }

  async function setGaProperty(property: string) {
    setBusy("ga");
    setError(null);
    const { error } = await supabase
      .from("projects")
      .update({ ga_property: property || null })
      .eq("id", project.id);
    if (error) setError(error.message);
    else await reload();
    setBusy(null);
  }

  async function loadKeywords() {
    setBusy("keywords");
    setError(null);
    try {
      const r = await api<{ rows: Row[] }>(
        `/api/projects/${project.id}/gsc/keywords`,
        undefined,
        "GET"
      );
      setRows(r.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שליפת מילות המפתח נכשלה");
    } finally {
      setBusy(null);
    }
  }

  if (!status) {
    return (
      <div className="flex justify-center py-4">
        <Spinner className="size-5" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}

      {!status.connected ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--muted)]">
            חבר את חשבון Google כדי לשלוף מילות מפתח אמיתיות שהאתר מדורג עליהן.
          </p>
          <Button onClick={connect} loading={busy === "connect"}>
            <Link2 className="size-4" />
            התחבר ל-Google Search Console
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--muted)]">
              מחובר{status.google_email ? ` כ-${status.google_email}` : ""}
            </p>
            <Button variant="ghost" onClick={disconnect}>
              <Unlink className="size-4" />
              ניתוק
            </Button>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--text)]">
              נכס Search Console של הפרויקט
            </label>
            <select
              value={project.gsc_property ?? ""}
              onChange={(e) => setProperty(e.target.value)}
              disabled={busy === "property"}
              dir="ltr"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40"
            >
              <option value="">— בחר נכס —</option>
              {sites.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--text)]">
              נכס Google Analytics (GA4) של הפרויקט
            </label>
            <select
              value={project.ga_property ?? ""}
              onChange={(e) => setGaProperty(e.target.value)}
              disabled={busy === "ga"}
              dir="ltr"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40"
            >
              <option value="">— בחר נכס —</option>
              {gaProps.map((g) => (
                <option key={g.property} value={g.property}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>

          {project.gsc_property && (
            <div className="space-y-3">
              <Button variant="outline" onClick={loadKeywords} loading={busy === "keywords"}>
                <Search className="size-4" />
                שלוף מילות מפתח (90 ימים אחרונים)
              </Button>

              {rows && rows.length === 0 && (
                <p className="text-sm text-[var(--muted)]">אין נתונים לנכס זה בטווח הזמן.</p>
              )}

              {rows && rows.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--surface-2)] text-[var(--muted)]">
                      <tr>
                        <th className="p-2 text-right font-medium">מילת מפתח</th>
                        <th className="p-2 text-center font-medium">קליקים</th>
                        <th className="p-2 text-center font-medium">חשיפות</th>
                        <th className="p-2 text-center font-medium">מיקום</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const added = keywords.includes(r.query);
                        return (
                          <tr key={r.query} className="border-t border-[var(--border)]">
                            <td className="p-2 text-right">{r.query}</td>
                            <td className="p-2 text-center tabular-nums">{r.clicks}</td>
                            <td className="p-2 text-center tabular-nums">{r.impressions}</td>
                            <td className="p-2 text-center tabular-nums">{r.position.toFixed(1)}</td>
                            <td className="p-2 text-center">
                              <button
                                onClick={() => onAddKeyword(r.query)}
                                disabled={added}
                                title={added ? "כבר ברשימה" : "הוסף למילות המפתח"}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--muted)] enabled:hover:bg-[var(--surface-2)] enabled:hover:text-[var(--text)] disabled:opacity-40"
                              >
                                <Plus className="size-3.5" />
                                {added ? "נוסף" : "הוסף"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
