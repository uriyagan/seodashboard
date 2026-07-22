import { useEffect, useState } from "react";
import { RefreshCw, Save, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { useProjects } from "@/lib/projects";
import { Alert, Button, Card, Input, Label } from "@/components/ui";
import { CompanionSnippet } from "@/components/CompanionSnippet";

export function ProjectSettings() {
  const { activeProject, reload, setActiveId, projects } = useProjects();
  const [name, setName] = useState("");
  const [contentPrompt, setContentPrompt] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [cadence, setCadence] = useState(1);
  const [stuckDays, setStuckDays] = useState(3);
  const [busy, setBusy] = useState<null | "save" | "sync" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProject) return;
    setName(activeProject.name);
    setContentPrompt(activeProject.content_prompt ?? "");
    setImagePrompt(activeProject.image_prompt ?? "");
    setCadence(activeProject.cadence_per_week ?? 1);
    setStuckDays(activeProject.stuck_draft_days ?? 3);
  }, [activeProject]);

  if (!activeProject) return null;

  async function save() {
    setBusy("save");
    setError(null);
    setNotice(null);
    const { error } = await supabase
      .from("projects")
      .update({
        name: name.trim(),
        content_prompt: contentPrompt,
        image_prompt: imagePrompt,
        cadence_per_week: cadence,
        stuck_draft_days: stuckDays,
      })
      .eq("id", activeProject!.id);
    if (error) setError(error.message);
    else {
      setNotice("ההגדרות נשמרו.");
      await reload();
    }
    setBusy(null);
  }

  async function resync() {
    setBusy("sync");
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ ok: boolean; posts?: number; error?: string }>(
        `/api/projects/${activeProject!.id}/sync`
      );
      if (!r.ok) throw new Error(r.error);
      setNotice(`סונכרנו ${r.posts ?? 0} פוסטים.`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "הסנכרון נכשל");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`למחוק את הפרויקט "${activeProject!.name}"? פעולה זו תמחק גם את הפוסטים והרעיונות המקומיים.`))
      return;
    setBusy("delete");
    const { error } = await supabase.from("projects").delete().eq("id", activeProject!.id);
    if (error) {
      setError(error.message);
      setBusy(null);
      return;
    }
    const remaining = projects.filter((p) => p.id !== activeProject!.id);
    await reload();
    if (remaining[0]) setActiveId(remaining[0].id);
  }

  return (
    <div className="p-[60px]">
      <h1 className="mb-1 text-2xl font-bold text-[var(--text)]">הגדרות פרויקט</h1>
      <p className="mb-6 text-sm text-[var(--muted)]" dir="ltr">{activeProject.site_url}</p>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {notice && <div className="mb-4"><Alert variant="success">{notice}</Alert></div>}

      <Card className="mb-4 space-y-4 p-5">
        <div>
          <Label htmlFor="s-name">שם הפרויקט</Label>
          <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </Card>

      <Card className="mb-4 space-y-4 p-5">
        <h2 className="text-base font-semibold text-[var(--text)]">פרומפטים (AI)</h2>
        <div>
          <Label htmlFor="cp">פרומפט ליצירת תוכן</Label>
          <textarea
            id="cp"
            rows={6}
            value={contentPrompt}
            onChange={(e) => setContentPrompt(e.target.value)}
            placeholder="לדוגמה: כתוב מאמר מקצועי בעברית בגוף שלישי, טון מקצועי, כ-800 מילים, עם כותרות משנה…"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm leading-relaxed outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40"
          />
        </div>
        <div>
          <Label htmlFor="ip">פרומפט ליצירת תמונה ראשית</Label>
          <textarea
            id="ip"
            rows={5}
            value={imagePrompt}
            onChange={(e) => setImagePrompt(e.target.value)}
            placeholder="לדוגמה: תמונה מקצועית ונקייה בסגנון מודרני, תאורה רכה, ללא טקסט…"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm leading-relaxed outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40"
          />
        </div>
      </Card>

      <Card className="mb-4 grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="cad">קצב פרסום (פוסטים לשבוע)</Label>
          <Input
            id="cad"
            type="number"
            min={1}
            value={cadence}
            onChange={(e) => setCadence(Number(e.target.value))}
          />
        </div>
        <div>
          <Label htmlFor="stuck">התראת "טיוטה תקועה" אחרי (ימים)</Label>
          <Input
            id="stuck"
            type="number"
            min={1}
            value={stuckDays}
            onChange={(e) => setStuckDays(Number(e.target.value))}
          />
        </div>
      </Card>

      {activeProject.companion_token && (
        <Card className="mb-4 space-y-3 p-5">
          <div>
            <h2 className="text-base font-semibold text-[var(--text)]">
              סניפט Companion (לאתרים מאחורי חומת אש)
            </h2>
            <p className="text-sm text-[var(--muted)]">
              אם סנכרון/דחיפה נכשלים בגלל חסימת אבטחה של האחסון — הדבק את הסניפט הזה באתר.
            </p>
          </div>
          <CompanionSnippet token={activeProject.companion_token} />
        </Card>
      )}

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button onClick={save} loading={busy === "save"}>
            <Save className="size-4" />
            שמירת הגדרות
          </Button>
          <Button variant="outline" onClick={resync} loading={busy === "sync"}>
            <RefreshCw className="size-4" />
            סנכרון מחדש
          </Button>
        </div>
        <Button variant="danger" onClick={remove} loading={busy === "delete"}>
          <Trash2 className="size-4" />
          מחיקת פרויקט
        </Button>
      </div>
    </div>
  );
}
