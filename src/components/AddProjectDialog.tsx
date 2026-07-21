import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useProjects } from "@/lib/projects";
import { Alert, Button, Input, Label } from "@/components/ui";

/**
 * Phase 1: minimal "add site" — creates a project row (name + URL).
 * Phase 2 replaces this with the full 3-step wizard (WP auth + immediate sync).
 */
export function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const { reload, setActiveId } = useProjects();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const normalizedUrl = url.trim().replace(/\/+$/, "");
      const { data, error } = await supabase
        .from("projects")
        .insert({ name: name.trim(), site_url: normalizedUrl })
        .select("id")
        .single();
      if (error) throw error;
      await reload();
      if (data?.id) setActiveId(data.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "יצירת הפרויקט נכשלה");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--text)]">הוספת אתר חדש</h2>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)]"
            aria-label="סגירה"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div>
            <Label htmlFor="p-name">שם הלקוח / האתר</Label>
            <Input
              id="p-name"
              placeholder="לדוגמה: דריי וול"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="p-url">כתובת האתר</Label>
            <Input
              id="p-url"
              type="url"
              dir="ltr"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </div>
          <p className="text-xs text-[var(--muted)]">
            חיבור WordPress וסנכרון הפוסטים יתווספו בשלב הבא (אשף החיבור).
          </p>
          <div className="flex justify-start gap-2 pt-1">
            <Button type="submit" loading={loading}>
              יצירה
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              ביטול
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
