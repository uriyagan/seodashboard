import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Globe, Plus } from "lucide-react";
import { useProjects } from "@/lib/projects";
import { cn } from "@/lib/utils";

export function ProjectSwitcher({
  onAdd,
  openUp = false,
}: {
  onAdd: () => void;
  openUp?: boolean;
}) {
  const { projects, activeProject, setActiveId } = useProjects();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
      >
        <span className="flex items-center gap-2 truncate">
          <Globe className="size-4 shrink-0 text-[var(--muted)]" />
          <span className="truncate">{activeProject?.name ?? "בחר פרויקט"}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-[var(--muted)]" />
      </button>

      {open && (
        <div
          className={cn(
            "absolute right-0 z-40 w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-xl",
            openUp ? "bottom-12" : "top-12"
          )}
        >
          <div className="max-h-72 overflow-y-auto">
            {projects.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-[var(--muted)]">
                עדיין אין פרויקטים
              </p>
            )}
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setActiveId(p.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-sm transition-colors hover:bg-[var(--surface-2)]",
                  p.id === activeProject?.id && "bg-[var(--surface-2)]"
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-[var(--text)]">{p.name}</span>
                  <span dir="ltr" className="truncate text-xs text-[var(--muted)]">
                    {p.site_url}
                  </span>
                </span>
                {p.id === activeProject?.id && (
                  <Check className="size-4 shrink-0 text-[var(--brand)]" />
                )}
              </button>
            ))}
          </div>

          <div className="mt-1.5 border-t border-[var(--border)] pt-1.5">
            <button
              onClick={() => {
                setOpen(false);
                onAdd();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[var(--brand)] transition-colors hover:bg-[var(--surface-2)]"
            >
              <Plus className="size-4" />
              הוסף אתר חדש
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
