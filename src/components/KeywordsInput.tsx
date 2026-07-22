import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

/** Free-form chip input for a project's target keyword phrases. */
export function KeywordsInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add(phrase: string) {
    const p = phrase.trim();
    if (!p) return;
    if (!value.some((v) => v.toLowerCase() === p.toLowerCase())) onChange([...value, p]);
    setDraft("");
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      remove(value.length - 1);
    }
  }

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
      {value.map((kw, i) => (
        <span
          key={kw + i}
          className="flex items-center gap-1 rounded-md bg-[var(--surface-2)] px-2 py-0.5 text-sm text-[var(--text)]"
        >
          {kw}
          <button type="button" onClick={() => remove(i)} aria-label="הסרה">
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
        placeholder={value.length ? "" : "הקלד ביטוי חיפוש ולחץ Enter…"}
        className="min-w-40 flex-1 bg-transparent px-1 text-sm outline-none"
      />
    </div>
  );
}
