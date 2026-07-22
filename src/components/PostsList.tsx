import { useCallback, useEffect, useState } from "react";
import { Eye, FileText, Image as ImageIcon, Plus, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { useProjects } from "@/lib/projects";
import { Button, Card, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

interface Term {
  id: number;
  name: string;
}
interface PostRow {
  id: string;
  wp_post_id: number | null;
  title: string;
  wp_status: string;
  link: string | null;
  featured_thumb_url: string | null;
  categories: Term[];
  tags: Term[];
  published_at: string | null;
  pushed_at: string | null;
  updated_at: string;
}

const STATUS_HE: Record<string, { label: string; solid?: boolean }> = {
  publish: { label: "פורסם", solid: true },
  draft: { label: "טיוטה" },
  pending: { label: "ממתין" },
  private: { label: "פרטי" },
  future: { label: "מתוזמן" },
};

function TermPills({ terms }: { terms: Term[] }) {
  if (!terms?.length) return <span className="text-[var(--muted)]">—</span>;
  const shown = terms.slice(0, 2);
  return (
    <div className="flex max-w-[180px] flex-wrap gap-1">
      {shown.map((t) => (
        <span
          key={t.id}
          className="truncate rounded-md bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--muted)]"
        >
          {t.name}
        </span>
      ))}
      {terms.length > shown.length && (
        <span className="text-xs text-[var(--muted)]">+{terms.length - shown.length}</span>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_HE[status] ?? { label: status };
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-medium",
        s.solid
          ? "bg-[var(--brand)] text-[var(--brand-fg)]"
          : "border border-[var(--border)] text-[var(--muted)]"
      )}
    >
      {s.label}
    </span>
  );
}

export function PostsList({
  onNew,
  onEdit,
}: {
  onNew: () => void;
  onEdit: (postId: string) => void;
}) {
  const { activeProject } = useProjects();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("posts")
      .select("id, wp_post_id, title, wp_status, link, featured_thumb_url, categories, tags, published_at, pushed_at, updated_at")
      .eq("project_id", activeProject.id)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false });
    if (error) setError(error.message);
    else setPosts((data ?? []) as PostRow[]);
    setLoading(false);
  }, [activeProject]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resync() {
    if (!activeProject) return;
    setSyncing(true);
    setError(null);
    try {
      await api(`/api/projects/${activeProject.id}/sync`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "סנכרון נכשל");
    } finally {
      setSyncing(false);
    }
  }

  if (!activeProject) return null;

  return (
    <div className="p-[60px]">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">פוסטים</h1>
          <p className="text-sm text-[var(--muted)]">{posts.length} פוסטים בפרויקט</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={resync} loading={syncing}>
            {!syncing && <RefreshCw className="size-4" />}
            סנכרון מחדש
          </Button>
          <Button onClick={onNew}>
            <Plus className="size-4" />
            פוסט חדש
          </Button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-[var(--color-danger)]">{error}</p>}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner className="size-6" />
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <FileText className="size-8 text-[var(--muted)]" />
            <p className="text-sm text-[var(--muted)]">
              אין פוסטים עדיין. נסה "סנכרון מחדש" או צור פוסט חדש (בקרוב).
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                  <th className="px-4 py-3 font-medium">תמונה</th>
                  <th className="px-4 py-3 font-medium">כותרת</th>
                  <th className="px-4 py-3 font-medium">קטגוריות</th>
                  <th className="px-4 py-3 font-medium">תגיות</th>
                  <th className="px-4 py-3 font-medium">סטטוס</th>
                  <th className="px-4 py-3 font-medium">תאריך</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => onEdit(p.id)}
                    className="cursor-pointer border-b border-[var(--border)] last:border-0 transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <td className="px-4 py-3">
                      {p.featured_thumb_url ? (
                        <img
                          src={p.featured_thumb_url}
                          alt=""
                          className="size-[100px] rounded-lg border border-[var(--border)] object-cover"
                        />
                      ) : (
                        <div className="flex size-[100px] items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-[var(--muted)]">
                          <ImageIcon className="size-5" />
                        </div>
                      )}
                    </td>
                    <td className="max-w-xs px-4 py-3 font-medium text-[var(--text)]">
                      <span className="line-clamp-2">{p.title || "(ללא כותרת)"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <TermPills terms={p.categories} />
                    </td>
                    <td className="px-4 py-3">
                      <TermPills terms={p.tags} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.wp_status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[var(--muted)]" dir="ltr">
                      {(p.published_at ?? p.pushed_at)?.slice(0, 10) ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {p.link && (
                        <a
                          href={p.link}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                          title="צפייה בפוסט באתר"
                          aria-label="צפייה בפוסט באתר"
                        >
                          <Eye className="size-4" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
