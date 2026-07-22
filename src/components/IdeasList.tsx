import { useCallback, useEffect, useState } from "react";
import { Lightbulb, Package, PenLine, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { useProjects } from "@/lib/projects";
import { Alert, Button, Card, Spinner } from "@/components/ui";

interface Idea {
  id: string;
  title: string;
  status: string;
  created_at: string;
  product_category_name: string | null;
}

interface Category {
  id: number;
  name: string;
  count: number;
}

/** Modal to pick which product categories to generate ideas for (spec §1.6). */
function CategoryModal({
  projectId,
  onClose,
  onGenerate,
}: {
  projectId: string;
  onClose: () => void;
  onGenerate: (categoryIds: number[]) => void;
}) {
  const [cats, setCats] = useState<Category[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ categories: Category[] }>(`/api/projects/${projectId}/idea-categories`, undefined, "GET")
      .then((r) => setCats(r.categories))
      .catch((e) => setError(e instanceof Error ? e.message : "טעינת הקטגוריות נכשלה"));
  }, [projectId]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-bold text-[var(--text)]">בחירת קטגוריות מוצרים</h2>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)]"
            aria-label="סגירה"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <p className="mb-3 text-sm text-[var(--muted)]">
            בחר קטגוריות שעבורן לקבל רעיונות, או המשך מכל הקטגוריות. מוצגות רק קטגוריות עם 5+ מוצרים במלאי.
          </p>
          {error && <Alert>{error}</Alert>}
          {!cats && !error && (
            <div className="flex justify-center py-8">
              <Spinner className="size-6" />
            </div>
          )}
          {cats && cats.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--muted)]">
              אין קטגוריות מוצרים עם מספיק מוצרים במלאי. ודא שהאתר מסונכרן (WooCommerce).
            </p>
          )}
          {cats && cats.length > 0 && (
            <ul className="space-y-1.5">
              {cats.map((cat) => (
                <li key={cat.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] p-2.5 transition-colors hover:bg-[var(--surface-2)]">
                    <input
                      type="checkbox"
                      checked={selected.has(cat.id)}
                      onChange={() => toggle(cat.id)}
                      className="size-4 accent-[var(--brand)]"
                    />
                    <span className="flex-1 text-sm text-[var(--text)]">{cat.name}</span>
                    <span className="text-xs text-[var(--muted)]">{cat.count} מוצרים</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-4">
          <Button variant="ghost" onClick={() => onGenerate([])} disabled={!cats?.length}>
            מכל הקטגוריות
          </Button>
          <Button onClick={() => onGenerate([...selected])} disabled={selected.size === 0}>
            <Sparkles className="size-4" />
            צור רעיונות ({selected.size})
          </Button>
        </div>
      </div>
    </div>
  );
}

export function IdeasList({ onEditPost }: { onEditPost: (postId: string) => void }) {
  const { activeProject } = useProjects();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [writingId, setWritingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    const { data } = await supabase
      .from("ideas")
      .select("id, title, status, created_at, product_category_name")
      .eq("project_id", activeProject.id)
      .eq("status", "suggested")
      .order("created_at", { ascending: false });
    setIdeas((data ?? []) as Idea[]);
    setLoading(false);
  }, [activeProject]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate(categoryIds: number[]) {
    if (!activeProject) return;
    setModalOpen(false);
    setGenerating(true);
    setError(null);
    try {
      const r = await api<{ ok: boolean; error?: string }>(
        `/api/projects/${activeProject.id}/ideas/generate`,
        { categoryIds }
      );
      if (!r.ok) throw new Error(r.error || "יצירת רעיונות נכשלה");
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
    <div className="p-5 sm:p-8 lg:p-[60px]">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">רעיונות לפוסטים</h1>
          <p className="text-sm text-[var(--muted)]">
            Gemini מציע פוסטים חדשים לפי קטגוריות המוצרים והמלאי בחנות
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setModalOpen(true)} loading={generating}>
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
            אין רעיונות כרגע. לחץ על "הצע לי רעיונות חדשים" כדי לקבל רעיונות מבוססי-קטגוריה.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {ideas.map((idea) => (
            <Card key={idea.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <span className="font-medium text-[var(--text)]">{idea.title}</span>
                {idea.product_category_name && (
                  <span className="mt-1.5 flex w-fit items-center gap-1 rounded-md bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--muted)]">
                    <Package className="size-3" />
                    {idea.product_category_name}
                  </span>
                )}
              </div>
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

      {modalOpen && (
        <CategoryModal
          projectId={activeProject.id}
          onClose={() => setModalOpen(false)}
          onGenerate={generate}
        />
      )}
    </div>
  );
}
