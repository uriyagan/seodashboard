import { useCallback, useEffect, useState } from "react";
import { Lightbulb, PenLine, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { useProjects } from "@/lib/projects";
import { Alert, Button, Card, Spinner } from "@/components/ui";

interface Idea {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

export function IdeasList({ onEditPost }: { onEditPost: (postId: string) => void }) {
  const { activeProject } = useProjects();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [writingId, setWritingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    const { data } = await supabase
      .from("ideas")
      .select("id, title, status, created_at")
      .eq("project_id", activeProject.id)
      .eq("status", "suggested")
      .order("created_at", { ascending: false });
    setIdeas((data ?? []) as Idea[]);
    setLoading(false);
  }, [activeProject]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    if (!activeProject) return;
    setGenerating(true);
    setError(null);
    try {
      await api(`/api/projects/${activeProject.id}/ideas/generate`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "יצירת רעיונות נכשלה");
    } finally {
      setGenerating(false);
    }
  }

  async function write(idea: Idea) {
    if (!activeProject) return;
    setWritingId(idea.id);
    setError(null);
    try {
      const r = await api<{ ok: boolean; postId?: string; error?: string }>(
        `/api/projects/${activeProject.id}/ideas/${idea.id}/write`
      );
      if (!r.ok || !r.postId) throw new Error(r.error || "כתיבת הפוסט נכשלה");
      await load();
      onEditPost(r.postId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "כתיבת הפוסט נכשלה");
    } finally {
      setWritingId(null);
    }
  }

  async function reject(id: string) {
    await supabase.from("ideas").update({ status: "rejected" }).eq("id", id);
    setIdeas((prev) => prev.filter((i) => i.id !== id));
  }

  if (!activeProject) return null;

  return (
    <div className="p-[60px]">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">רעיונות לפוסטים</h1>
          <p className="text-sm text-[var(--muted)]">
            Gemini מציע פוסטים חדשים על סמך מה שכבר נכתב באתר
          </p>
        </div>
        <Button onClick={generate} loading={generating}>
          {!generating && <Sparkles className="size-4" />}
          הצע לי רעיונות חדשים
        </Button>
      </div>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : ideas.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-16 text-center">
          <Lightbulb className="size-8 text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)]">
            אין רעיונות כרגע. לחץ על "הצע לי רעיונות חדשים" כדי לקבל 10 רעיונות.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {ideas.map((idea) => (
            <Card key={idea.id} className="flex items-center justify-between gap-3 p-4">
              <span className="font-medium text-[var(--text)]">{idea.title}</span>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" onClick={() => write(idea)} loading={writingId === idea.id}>
                  {writingId !== idea.id && <PenLine className="size-4" />}
                  כתוב פוסט
                </Button>
                <button
                  onClick={() => reject(idea.id)}
                  className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--color-danger)]"
                  aria-label="דחייה"
                  title="דחה רעיון"
                >
                  <X className="size-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
