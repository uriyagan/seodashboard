import { useState } from "react";
import { FileText, Package, Plus, Sparkles, Tag as TagIcon, Check } from "lucide-react";
import { api } from "@/lib/api";
import { Spinner } from "@/components/ui";

interface Suggestion {
  anchor: string;
  target_url: string;
  target_title: string;
  target_type: string;
  reason: string;
}

const TYPE_META: Record<string, { label: string; icon: typeof FileText }> = {
  post: { label: "פוסט", icon: FileText },
  page: { label: "עמוד", icon: FileText },
  product_cat: { label: "קטגוריית מוצר", icon: Package },
  product_tag: { label: "תגית מוצר", icon: TagIcon },
};

export function InternalLinks({
  projectId,
  content,
  title,
  onApply,
}: {
  projectId: string;
  content: string;
  title?: string;
  onApply: (anchor: string, url: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [inserted, setInserted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ suggestions: Suggestion[] }>(
        `/api/projects/${projectId}/internal-links`,
        { content_html: content, title }
      );
      setSuggestions(r.suggestions);
      setInserted(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "הניתוח נכשל");
    } finally {
      setLoading(false);
    }
  }

  function apply(s: Suggestion) {
    onApply(s.anchor, s.target_url);
    setInserted((prev) => new Set(prev).add(s.anchor.toLowerCase()));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text)]">קישורים פנימיים (AI)</h3>
        <button
          onClick={analyze}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50"
        >
          {loading ? <Spinner className="size-3.5" /> : <Sparkles className="size-3.5" />}
          {suggestions ? "נתח מחדש" : "נתח את הפוסט"}
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">
        ה-AI קורא את הפוסט ואת כל היעדים באתר (עמודים, קטגוריות/תגיות מוצר, פוסטים) ומציע קישורים בעלי ערך אמיתי לגולש.
      </p>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {loading && (
        <div className="flex items-center gap-2 py-3 text-xs text-[var(--muted)]">
          <Spinner className="size-4" />
          מנתח את הפוסט…
        </div>
      )}

      {!loading && suggestions?.length === 0 && (
        <p className="py-3 text-center text-xs text-[var(--muted)]">
          ה-AI לא מצא קישורים בעלי ערך מובהק לפוסט הנוכחי.
        </p>
      )}

      {!loading && suggestions && suggestions.length > 0 && (
        <ul className="space-y-1.5">
          {suggestions.map((s, i) => {
            const meta = TYPE_META[s.target_type] ?? { label: s.target_type, icon: FileText };
            const Icon = meta.icon;
            const done = inserted.has(s.anchor.toLowerCase());
            return (
              <li key={s.anchor + i}>
                <button
                  onClick={() => apply(s)}
                  disabled={done}
                  className="group flex w-full items-start gap-2 rounded-lg border border-[var(--border)] p-2.5 text-right transition-colors enabled:hover:bg-[var(--surface-2)] disabled:opacity-60"
                  title={done ? "נוסף" : "הוסף קישור בעורך"}
                >
                  {done ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Plus className="mt-0.5 size-4 shrink-0 text-[var(--muted)] group-hover:text-[var(--text)]" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-[var(--text)]">«{s.anchor}»</span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--muted)]">
                      <Icon className="size-3 shrink-0" />
                      {meta.label}: {s.target_title}
                    </span>
                    {s.reason && (
                      <span className="mt-1 block text-xs leading-snug text-[var(--muted)]">
                        {s.reason}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
