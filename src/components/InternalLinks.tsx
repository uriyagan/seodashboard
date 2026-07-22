import { useEffect, useMemo, useState } from "react";
import { FileText, LinkIcon, Package, Search, Tag as TagIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

interface Target {
  wp_id: number;
  type: string;
  title: string;
  url: string;
}

const TYPE_META: Record<string, { label: string; icon: typeof FileText }> = {
  post: { label: "פוסט", icon: FileText },
  page: { label: "עמוד", icon: FileText },
  product_cat: { label: "קטגוריית מוצר", icon: Package },
  product_tag: { label: "תגית מוצר", icon: TagIcon },
};

const STOP = new Set(["של", "עם", "על", "או", "גם", "כל", "זה", "הוא", "היא", "כי", "אם", "יש", "לא", "the", "and", "for"]);

function tokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export function InternalLinks({
  projectId,
  context,
  onInsert,
}: {
  projectId: string;
  context: string; // title + keyword + content, for relevance ranking
  onInsert: (url: string, title: string) => void;
}) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    supabase
      .from("link_targets")
      .select("wp_id, type, title, url")
      .eq("project_id", projectId)
      .then(({ data }) => setTargets((data ?? []) as Target[]));
  }, [projectId]);

  const ranked = useMemo(() => {
    const ctx = new Set(tokens(context));
    const scored = targets.map((t) => {
      const tw = tokens(t.title);
      const overlap = tw.filter((w) => ctx.has(w)).length;
      return { t, score: overlap };
    });
    const q = query.trim().toLowerCase();
    const filtered = q
      ? scored.filter((s) => s.t.title.toLowerCase().includes(q))
      : scored;
    return filtered
      .sort((a, b) => b.score - a.score || a.t.title.localeCompare(b.t.title))
      .slice(0, 12);
  }, [targets, context, query]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text)]">קישורים פנימיים מומלצים</h3>
        <span className="text-xs text-[var(--muted)]">{targets.length} יעדים</span>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש יעד…"
          className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pr-9 pl-3 text-sm outline-none focus-visible:border-[var(--brand)]"
        />
      </div>

      <ul className="space-y-1">
        {ranked.length === 0 && (
          <li className="py-3 text-center text-xs text-[var(--muted)]">
            אין יעדים — סנכרן את האתר תחילה.
          </li>
        )}
        {ranked.map(({ t, score }) => {
          const meta = TYPE_META[t.type] ?? { label: t.type, icon: FileText };
          const Icon = meta.icon;
          return (
            <li key={t.type + t.wp_id}>
              <button
                onClick={() => onInsert(t.url, t.title)}
                className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-right transition-colors hover:bg-[var(--surface-2)]"
                title="הוסף קישור בעורך"
              >
                <Icon className="size-3.5 shrink-0 text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text)]">{t.title}</span>
                {score > 0 && (
                  <span className={cn("shrink-0 rounded-full bg-[var(--surface-2)] px-1.5 text-[10px] text-[var(--muted)]")}>
                    {meta.label}
                  </span>
                )}
                <LinkIcon className="size-3.5 shrink-0 text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
