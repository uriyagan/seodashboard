import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface Term {
  id: number;
  name: string;
}

/**
 * Multi-select for WordPress categories/tags, sourced from the local wp_terms
 * cache, with the ability to create a new term on the site.
 */
export function TermSelect({
  projectId,
  taxonomy, // "category" | "post_tag"
  apiTaxonomy, // "categories" | "tags"
  label,
  selected,
  onChange,
}: {
  projectId: string;
  taxonomy: "category" | "post_tag";
  apiTaxonomy: "categories" | "tags";
  label: string;
  selected: Term[];
  onChange: (terms: Term[]) => void;
}) {
  const [all, setAll] = useState<Term[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase
      .from("wp_terms")
      .select("wp_term_id, name")
      .eq("project_id", projectId)
      .eq("taxonomy", taxonomy)
      .order("name")
      .then(({ data }) => {
        setAll((data ?? []).map((t: { wp_term_id: number; name: string }) => ({ id: t.wp_term_id, name: t.name })));
      });
  }, [projectId, taxonomy]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const selectedIds = new Set(selected.map((t) => t.id));
  const filtered = all.filter(
    (t) => !selectedIds.has(t.id) && t.name.toLowerCase().includes(query.toLowerCase())
  );
  const exactExists = all.some((t) => t.name.toLowerCase() === query.trim().toLowerCase());

  function add(t: Term) {
    onChange([...selected, t]);
    setQuery("");
  }
  function remove(id: number) {
    onChange(selected.filter((t) => t.id !== id));
  }

  async function createNew() {
    const name = query.trim();
    if (!name) return;
    setCreating(true);
    try {
      const r = await api<{ ok: boolean; term?: Term; error?: string }>(
        `/api/projects/${projectId}/terms`,
        { taxonomy: apiTaxonomy, name }
      );
      if (r.ok && r.term) {
        setAll((prev) => [...prev, { id: r.term!.id, name: r.term!.name }]);
        add({ id: r.term.id, name: r.term.name });
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">{label}</label>
      <div
        className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
        onClick={() => setOpen(true)}
      >
        {selected.map((t) => (
          <span
            key={t.id}
            className="flex items-center gap-1 rounded-md bg-[var(--brand-soft)] px-2 py-0.5 text-sm text-[var(--brand)]"
          >
            {t.name}
            <button type="button" onClick={() => remove(t.id)} aria-label="הסרה">
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={selected.length ? "" : "חיפוש או הוספה…"}
          className="min-w-24 flex-1 bg-transparent px-1 text-sm outline-none"
        />
      </div>

      {open && (query || filtered.length > 0) && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg">
          {filtered.slice(0, 30).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => add(t)}
              className="block w-full rounded-md px-3 py-1.5 text-right text-sm hover:bg-[var(--surface-2)]"
            >
              {t.name}
            </button>
          ))}
          {query.trim() && !exactExists && (
            <button
              type="button"
              onClick={createNew}
              disabled={creating}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-right text-sm font-medium text-[var(--brand)] hover:bg-[var(--surface-2)]"
              )}
            >
              <Plus className="size-4" />
              {creating ? "יוצר…" : `צור "${query.trim()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
