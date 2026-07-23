import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Gauge,
  Lightbulb,
  Package,
  PenLine,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { useProjects } from "@/lib/projects";
import { Alert, Button, Card, Spinner } from "@/components/ui";

interface IdeaBrief {
  summary: string;
  angle: string;
  main_topics: string[];
  deep_dive_points: string[];
  target_audience: string;
  search_intent: string;
  reader_value: string;
  category_fit: string;
  primary_keyword: string;
  secondary_keywords: string[];
  journey_stage: string;
  seo_evidence_type: "external-data" | "qualitative-estimate";
}

interface Idea {
  id: string;
  title: string;
  status: string;
  created_at: string;
  product_category_name: string | null;
  brief: IdeaBrief | null;
}

const JOURNEY_LABEL: Record<string, string> = {
  discovery: "גילוי",
  comparison: "השוואה",
  decision: "החלטה",
  "post-purchase": "לאחר רכישה",
};

function Chip({ children, icon: Icon }: { children: React.ReactNode; icon?: typeof Package }) {
  return (
    <span className="flex w-fit items-center gap-1 rounded-md bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--muted)]">
      {Icon && <Icon className="size-3" />}
      {children}
    </span>
  );
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
              לאתר זה אין קטגוריות מוצרים (אתר תדמית, או שטרם סונכרן). ניצור רעיונות כלליים על סמך התוכן הקיים.
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
          {cats && cats.length === 0 ? (
            <Button className="w-full" onClick={() => onGenerate([])}>
              <Sparkles className="size-4" />
              צור רעיונות כלליים
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onGenerate([])} disabled={!cats?.length}>
                מכל הקטגוריות
              </Button>
              <Button onClick={() => onGenerate([...selected])} disabled={selected.size === 0}>
                <Sparkles className="size-4" />
                צור רעיונות ({selected.size})
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** A single idea card — rich brief view (with expand/collapse) or a legacy flat card. */
function IdeaCard({
  idea,
  writing,
  onWrite,
  onReject,
}: {
  idea: Idea;
  writing: boolean;
  onWrite: () => void;
  onReject: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const b = idea.brief;

  const actions = (
    <div className="flex shrink-0 items-center gap-2">
      <Button size="sm" onClick={onWrite} loading={writing}>
        {!writing && <PenLine className="size-4" />}
        יצירת פוסט
      </Button>
      <button
        onClick={onReject}
        className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--color-danger)]"
        aria-label="דחייה"
        title="דחה רעיון"
      >
        <X className="size-4" />
      </button>
    </div>
  );

  // Legacy idea (no brief) — keep the original compact card.
  if (!b) {
    return (
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <span className="font-medium text-[var(--text)]">{idea.title}</span>
          {idea.product_category_name && (
            <div className="mt-1.5">
              <Chip icon={Package}>{idea.product_category_name}</Chip>
            </div>
          )}
        </div>
        {actions}
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <span className="font-medium text-[var(--text)]">{idea.title}</span>
        {actions}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {idea.product_category_name && <Chip icon={Package}>{idea.product_category_name}</Chip>}
        {b.seo_evidence_type === "external-data" ? (
          <Chip icon={Search}>מבוסס נתוני חיפוש</Chip>
        ) : (
          <Chip icon={Gauge}>הערכת הזדמנות תוכן</Chip>
        )}
      </div>

      <p className="text-sm text-[var(--muted)]">{b.summary}</p>

      {b.main_topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {b.main_topics.slice(0, 5).map((t, i) => (
            <Chip key={i}>{t}</Chip>
          ))}
        </div>
      )}

      <div className="text-xs text-[var(--muted)]">
        כוונת חיפוש: <span className="text-[var(--text)]">{b.search_intent}</span> · מילת מפתח:{" "}
        <span className="text-[var(--text)]">{b.primary_keyword}</span>
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-fit items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
      >
        {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        {expanded ? "סגירת פרטים" : "פרטים מלאים"}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-[var(--border)] pt-3 text-sm">
          <Detail label="זווית מרכזית">{b.angle}</Detail>
          {b.deep_dive_points.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-[var(--muted)]">נקודות להעמקה</p>
              <ul className="list-disc space-y-0.5 pr-5 text-[var(--text)]">
                {b.deep_dive_points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <Detail label="קהל יעד">{b.target_audience}</Detail>
          <Detail label="ערך מעשי לקורא">{b.reader_value}</Detail>
          <Detail label="התאמה לקטגוריה">{b.category_fit}</Detail>
          <Detail label="שלב במסע הלקוח">{JOURNEY_LABEL[b.journey_stage] ?? b.journey_stage}</Detail>
          {b.secondary_keywords.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-[var(--muted)]">מילות מפתח משניות</p>
              <div className="flex flex-wrap gap-1.5">
                {b.secondary_keywords.map((k, i) => (
                  <Chip key={i}>{k}</Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs font-medium text-[var(--muted)]">{label}: </span>
      <span className="text-[var(--text)]">{children}</span>
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
      .select("id, title, status, created_at, product_category_name, brief")
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
            מחקר SEO קצר (נתוני חיפוש כשזמינים) + בריף מפורט לכל רעיון, לפי קטגוריות המוצרים והמלאי
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
            <IdeaCard
              key={idea.id}
              idea={idea}
              writing={writingId === idea.id}
              onWrite={() => write(idea)}
              onReject={() => reject(idea.id)}
            />
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
