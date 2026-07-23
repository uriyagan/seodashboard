import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon, X } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Spinner } from "@/components/ui";

interface MediaItem {
  id: number;
  url: string;
  thumb: string;
  alt: string;
  title: string;
}

/** Modal to browse and pick an image from the WordPress media library. */
export function WpMediaPicker({
  projectId,
  onClose,
  onPick,
}: {
  projectId: string;
  onClose: () => void;
  onPick: (item: { url: string; alt: string }) => void;
}) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(null);
    setError(null);
    try {
      const r = await api<{ ok: boolean; items: MediaItem[]; totalPages: number; error?: string }>(
        `/api/projects/${projectId}/media-list?page=${page}`,
        undefined,
        "GET"
      );
      if (!r.ok) throw new Error(r.error || "טעינת המדיה נכשלה");
      setItems(r.items);
      setTotalPages(r.totalPages || 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "טעינת המדיה נכשלה");
      setItems([]);
    }
  }, [projectId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-bold text-[var(--text)]">ספריית המדיה של WordPress</h2>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)]"
            aria-label="סגירה"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
          {!items ? (
            <div className="flex justify-center py-12">
              <Spinner className="size-6" />
            </div>
          ) : items.length === 0 && !error ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-[var(--muted)]">
              <ImageIcon className="size-8" />
              <p className="text-sm">אין תמונות בספרייה.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {items.map((m) => (
                <button
                  key={m.id}
                  onClick={() => onPick({ url: m.url, alt: m.alt })}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border)] hover:border-[var(--brand)]"
                  title={m.title || m.alt}
                >
                  <img src={m.thumb} alt={m.alt} className="size-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
            <Button
              size="sm"
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronRight className="size-4" />
              הקודם
            </Button>
            <span className="text-sm text-[var(--muted)]">
              עמוד {page} מתוך {totalPages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              הבא
              <ChevronLeft className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
