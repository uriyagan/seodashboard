import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface SyncProgress {
  label: string;
  current?: number;
  total?: number;
  done?: boolean;
  at?: string;
}

/**
 * Polls a project's live sync progress (written by the worker during a sync)
 * while `active` is true. Returns null when idle.
 */
export function useSyncProgress(
  projectId: string | undefined,
  active: boolean
): SyncProgress | null {
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  useEffect(() => {
    if (!active || !projectId) {
      setProgress(null);
      return;
    }
    let alive = true;
    const tick = async () => {
      const { data } = await supabase
        .from("projects")
        .select("sync_progress")
        .eq("id", projectId)
        .single();
      if (alive) setProgress((data?.sync_progress as SyncProgress) ?? null);
    };
    void tick();
    const iv = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [projectId, active]);

  return progress;
}

/** Human-readable one-liner for a progress object. */
export function formatSyncProgress(p: SyncProgress): string {
  if (p.total && p.current) return `${p.label} — עמוד ${p.current} מתוך ${p.total}`;
  return p.label;
}
