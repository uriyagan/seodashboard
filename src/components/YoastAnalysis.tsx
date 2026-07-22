import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { analyzeYoast, type Analysis, type Check, type Rating, type AnalysisInput } from "@/lib/yoast";
import { cn } from "@/lib/utils";

const RATING_ORDER: Record<Rating, number> = { bad: 0, ok: 1, good: 2 };
const DOT: Record<Rating, string> = {
  bad: "bg-red-500",
  ok: "bg-amber-500",
  good: "bg-green-500",
};
const RATING_HE: Record<Rating, string> = { bad: "דורש שיפור", ok: "בינוני", good: "טוב" };

function Section({ title, score, rating, checks }: { title: string; score: number; rating: Rating; checks: Check[] }) {
  const sorted = [...checks].sort((a, b) => RATING_ORDER[a.rating] - RATING_ORDER[b.rating]);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--text)]">{title}</span>
        <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <span className={cn("size-2.5 rounded-full", DOT[rating])} />
          {RATING_HE[rating]} · {Math.round(score)}/100
        </span>
      </div>
      <ul className="space-y-1">
        {sorted.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-sm text-[var(--text)]">
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[c.rating])} />
            <span>{c.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function YoastAnalysis({ input }: { input: AnalysisInput }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!input.keyword.trim() && !input.content.trim()) {
        setAnalysis(null);
        return;
      }
      setBusy(true);
      try {
        setAnalysis(await analyzeYoast(input));
      } catch {
        /* ignore */
      } finally {
        setBusy(false);
      }
    }, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [input.content, input.keyword, input.title, input.description, input.slug]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text)]">ניתוח Yoast (חי)</h3>
        {busy && <Loader2 className="size-4 animate-spin text-[var(--muted)]" />}
      </div>

      {!analysis && !busy && (
        <p className="text-xs text-[var(--muted)]">
          הזן מילת מפתח ותוכן כדי לקבל ניתוח SEO וקריאוּת בזמן אמת.
        </p>
      )}

      {analysis && (
        <div className="space-y-5">
          <Section title="SEO" {...analysis.seo} />
          <div className="h-px bg-[var(--border)]" />
          <Section title="קריאוּת" {...analysis.readability} />
        </div>
      )}
    </div>
  );
}
