import { useEffect, useState } from "react";
import { MousePointerClick, Eye, Gauge, Users, Activity, TrendingUp, TrendingDown } from "lucide-react";
import { api } from "@/lib/api";
import { Card, Spinner } from "@/components/ui";

interface Overview {
  connected: boolean;
  gsc: {
    totals: { clicks: number; impressions: number; ctr: number; position: number };
    prev: { clicks: number; impressions: number; ctr: number; position: number };
    series: { date: string; clicks: number; impressions: number }[];
    topQueries: { query: string; clicks: number; impressions: number; position: number }[];
  } | null;
  ga: {
    totals: { sessions: number; users: number };
    prev: { sessions: number; users: number };
    series: { date: string; sessions: number }[];
  } | null;
}

const nf = (n: number) => n.toLocaleString("he-IL", { maximumFractionDigits: 0 });

/** % change; for "position" lower is better, so callers flip `goodIsUp`. */
function Delta({ cur, prev, goodIsUp = true }: { cur: number; prev: number; goodIsUp?: boolean }) {
  if (prev === 0 && cur === 0) return <span className="text-xs text-[var(--muted)]">—</span>;
  const pct = prev === 0 ? 100 : ((cur - prev) / prev) * 100;
  const up = pct > 0;
  const good = up === goodIsUp;
  if (Math.abs(pct) < 0.5) return <span className="text-xs text-[var(--muted)]">≈</span>;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs ${
        good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
      }`}
    >
      <Icon className="size-3" />
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

/** Minimal area+line sparkline over a numeric series. */
function Spark({ values, className = "" }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const n = values.length;
  const pts = values.map((v, i) => [(i / (n - 1)) * 100, 28 - (v / max) * 26].map((x) => x.toFixed(2)));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  const area = `${line} L100,28 L0,28 Z`;
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className={`h-10 w-full ${className}`}>
      <path d={area} fill="var(--text)" opacity="0.06" />
      <path d={line} fill="none" stroke="var(--text)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  cur,
  prev,
  goodIsUp = true,
  spark,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
  cur: number;
  prev: number;
  goodIsUp?: boolean;
  spark?: number[];
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--muted)]">{label}</span>
        <Icon className="size-5 text-[var(--muted)]" />
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="text-2xl font-semibold text-[var(--text)]">{value}</p>
        <Delta cur={cur} prev={prev} goodIsUp={goodIsUp} />
      </div>
      {spark && spark.length > 1 && <Spark values={spark} className="mt-2" />}
    </Card>
  );
}

export function OrganicOverview({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setError(null);
    api<Overview>(`/api/projects/${projectId}/overview`, undefined, "GET")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "טעינת הנתונים נכשלה"))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (error) return <Card className="p-5 text-sm text-[var(--muted)]">{error}</Card>;

  if (!data?.connected) {
    return (
      <Card className="p-5 text-sm text-[var(--muted)]">
        חבר את Google Search Console ו-Analytics ב<strong className="text-[var(--text)]">הגדרות הפרויקט</strong> כדי לראות נתוני תנועה אורגנית.
      </Card>
    );
  }

  if (!data.gsc && !data.ga) {
    return (
      <Card className="p-5 text-sm text-[var(--muted)]">
        בחר נכס Search Console ו/או GA4 ב<strong className="text-[var(--text)]">הגדרות הפרויקט</strong> כדי להציג נתונים.
      </Card>
    );
  }

  const { gsc, ga } = data;
  const chart = ga
    ? { title: "סשנים אורגניים — 28 ימים אחרונים", series: ga.series.map((s) => ({ date: s.date, v: s.sessions })) }
    : gsc
      ? { title: "קליקים אורגניים — 28 ימים אחרונים", series: gsc.series.map((s) => ({ date: s.date, v: s.clicks })) }
      : null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[var(--text)]">תנועה אורגנית · 28 ימים אחרונים</h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {gsc && (
          <>
            <Stat
              icon={MousePointerClick}
              label="קליקים אורגניים (חיפוש)"
              value={nf(gsc.totals.clicks)}
              cur={gsc.totals.clicks}
              prev={gsc.prev.clicks}
              spark={gsc.series.map((s) => s.clicks)}
            />
            <Stat
              icon={Eye}
              label="חשיפות בחיפוש"
              value={nf(gsc.totals.impressions)}
              cur={gsc.totals.impressions}
              prev={gsc.prev.impressions}
              spark={gsc.series.map((s) => s.impressions)}
            />
            <Stat
              icon={Gauge}
              label="מיקום ממוצע"
              value={gsc.totals.position.toFixed(1)}
              cur={gsc.totals.position}
              prev={gsc.prev.position}
              goodIsUp={false}
            />
          </>
        )}
        {ga && (
          <>
            <Stat
              icon={Activity}
              label="סשנים אורגניים"
              value={nf(ga.totals.sessions)}
              cur={ga.totals.sessions}
              prev={ga.prev.sessions}
              spark={ga.series.map((s) => s.sessions)}
            />
            <Stat
              icon={Users}
              label="משתמשים אורגניים"
              value={nf(ga.totals.users)}
              cur={ga.totals.users}
              prev={ga.prev.users}
            />
          </>
        )}
      </div>

      {chart && chart.series.length > 1 && (
        <Card className="p-5">
          <p className="mb-3 text-sm text-[var(--muted)]">{chart.title}</p>
          <Spark values={chart.series.map((s) => s.v)} className="!h-32" />
        </Card>
      )}

      {gsc && gsc.topQueries.length > 0 && (
        <Card className="p-0">
          <p className="border-b border-[var(--border)] p-4 text-sm font-medium text-[var(--text)]">
            מילות החיפוש המובילות
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[var(--muted)]">
                <tr>
                  <th className="p-3 text-right font-medium">מילת מפתח</th>
                  <th className="p-3 text-center font-medium">קליקים</th>
                  <th className="p-3 text-center font-medium">חשיפות</th>
                  <th className="p-3 text-center font-medium">מיקום</th>
                </tr>
              </thead>
              <tbody>
                {gsc.topQueries.map((q) => (
                  <tr key={q.query} className="border-t border-[var(--border)]">
                    <td className="p-3 text-right">{q.query}</td>
                    <td className="p-3 text-center tabular-nums">{nf(q.clicks)}</td>
                    <td className="p-3 text-center tabular-nums">{nf(q.impressions)}</td>
                    <td className="p-3 text-center tabular-nums">{q.position.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
