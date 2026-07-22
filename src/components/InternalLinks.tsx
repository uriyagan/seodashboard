import { useEffect, useMemo, useState } from "react";
import { FileText, Package, Plus, Tag as TagIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Target {
  wp_id: number;
  type: string; // post | page | product_cat | product_tag
  title: string;
  url: string;
  stems: Set<string>;
  minRun: number;
}

interface Suggestion {
  anchor: string;
  target: Target;
  len: number;
}

const TYPE_META: Record<string, { label: string; icon: typeof FileText }> = {
  post: { label: "פוסט", icon: FileText },
  page: { label: "עמוד", icon: FileText },
  product_cat: { label: "קטגוריית מוצר", icon: Package },
  product_tag: { label: "תגית מוצר", icon: TagIcon },
};

const PREFIX = "בהוכלמש";
const STOP = new Set([
  "של", "עם", "על", "או", "גם", "כל", "זה", "הוא", "היא", "כי", "אם", "יש", "לא",
  "את", "אל", "כמו", "יותר", "רק", "אבל", "מה", "מי", "the", "and", "for", "מדריך",
]);

const stripSuffix = (w: string) => w.replace(/(יות|ות|ים)$/, "");

/**
 * Candidate normalized forms of a word (len ≥ 3), with and without a leading
 * Hebrew prefix letter. Comparing candidate SETS (rather than stripping to a
 * single stem) avoids mangling roots that legitimately start with a prefix
 * letter — e.g. "כוסות" keeps the form "כוס" instead of losing the כ.
 */
function forms(word: string): string[] {
  const base = word.toLowerCase();
  const out = new Set<string>();
  out.add(stripSuffix(base));
  if (base.length > 3 && PREFIX.includes(base[0])) out.add(stripSuffix(base.slice(1)));
  return [...out].filter((s) => s.length >= 3);
}

interface Tok {
  raw: string;
  forms: string[];
  start: number;
  end: number;
}
function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    toks.push({ raw: m[0], forms: forms(m[0]), start: m.index, end: m.index + m[0].length });
  }
  return toks;
}

/** Removes anchor contents so already-linked text isn't suggested, then strips tags. */
function toPlainText(html: string): string {
  return html
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");
}

export function InternalLinks({
  projectId,
  content,
  onApply,
}: {
  projectId: string;
  content: string;
  onApply: (anchor: string, url: string) => void;
}) {
  const [targets, setTargets] = useState<Target[]>([]);

  useEffect(() => {
    supabase
      .from("link_targets")
      .select("wp_id, type, title, url")
      .eq("project_id", projectId)
      .then(({ data }) => {
        const rows = (data ?? []) as Omit<Target, "stems" | "minRun">[];
        setTargets(
          rows.map((t) => {
            const stems = new Set(
              tokenize(t.title)
                .filter((w) => !STOP.has(stripSuffix(w.raw.toLowerCase())))
                .flatMap((w) => w.forms)
            );
            return {
              ...t,
              stems,
              minRun: t.type === "product_cat" || t.type === "product_tag" ? 1 : 2,
            };
          })
        );
      });
  }, [projectId]);

  // Scan the post text for phrases that match a target; suggest linking that
  // exact phrase to that target (longest / most specific match per anchor).
  const suggestions = useMemo<Suggestion[]>(() => {
    const text = toPlainText(content);
    const toks = tokenize(text);
    if (!toks.length) return [];
    const byAnchor = new Map<string, Suggestion>();

    for (const target of targets) {
      if (target.stems.size === 0) continue;
      let best: { s: number; e: number; len: number } | null = null;
      let runStart = -1;
      for (let i = 0; i <= toks.length; i++) {
        const ok =
          i < toks.length && toks[i].forms.some((f) => target.stems.has(f));
        if (ok) {
          if (runStart === -1) runStart = i;
        } else if (runStart !== -1) {
          const len = i - runStart;
          if (len >= target.minRun && (!best || len > best.len)) {
            best = { s: runStart, e: i - 1, len };
          }
          runStart = -1;
        }
      }
      if (!best) continue;
      const anchor = text.slice(toks[best.s].start, toks[best.e].end).trim();
      if (anchor.length < 2) continue;
      const key = anchor.toLowerCase();
      const existing = byAnchor.get(key);
      // Prefer the longer / product-taxonomy match for a given anchor.
      if (!existing || best.len > existing.len) {
        byAnchor.set(key, { anchor, target, len: best.len });
      }
    }

    return [...byAnchor.values()].sort((a, b) => b.len - a.len).slice(0, 20);
  }, [content, targets]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text)]">קישורים פנימיים מומלצים</h3>
        <span className="text-xs text-[var(--muted)]">{targets.length} יעדים</span>
      </div>
      <p className="text-xs text-[var(--muted)]">
        המערכת מזהה בתוכן הפוסט ביטויים שכדאי לקשר. לחיצה מוסיפה את הקישור בעורך.
      </p>

      {suggestions.length === 0 ? (
        <p className="py-3 text-center text-xs text-[var(--muted)]">
          {targets.length === 0
            ? "אין יעדים — סנכרן את האתר תחילה."
            : "לא נמצאו ביטויים מתאימים בתוכן הנוכחי."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {suggestions.map((s) => {
            const meta = TYPE_META[s.target.type] ?? { label: s.target.type, icon: FileText };
            const Icon = meta.icon;
            return (
              <li key={s.anchor + s.target.type + s.target.wp_id}>
                <button
                  onClick={() => onApply(s.anchor, s.target.url)}
                  className="group flex w-full items-start gap-2 rounded-lg border border-[var(--border)] p-2 text-right transition-colors hover:bg-[var(--surface-2)]"
                  title="הוסף קישור בעורך"
                >
                  <Plus className="mt-0.5 size-4 shrink-0 text-[var(--muted)] group-hover:text-[var(--text)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-[var(--text)]">
                      «{s.anchor}»
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--muted)]">
                      <Icon className="size-3" />
                      {meta.label}: {s.target.title}
                    </span>
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
