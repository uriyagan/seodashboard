/// <reference lib="webworker" />
import { analyzeYoast, type AnalysisInput } from "./yoast";

// Runs the (heavy) Yoast engine off the main thread so the editor stays responsive.
self.onmessage = async (e: MessageEvent<{ id: number; input: AnalysisInput }>) => {
  const { id, input } = e.data;
  try {
    const result = await analyzeYoast(input);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
