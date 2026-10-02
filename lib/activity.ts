import type { Theme } from "@earendil-works/pi-coding-agent";

export interface ActivityRunStats {
  startedAt?: number | null;
  elapsedMs: number;
  turns: number;
}

export interface ActivitySnapshot {
  isWorking: boolean;
  label: string | null;
  run?: ActivityRunStats;
}

export interface ActivityChange {
  type: string;
  run?: ActivityRunStats;
}

export interface ActivityApi {
  getActivity(): ActivitySnapshot;
  getStats?(): { workedMs: number };
  subscribe?(listener: (activity: ActivitySnapshot, change: ActivityChange) => void): () => void;
  shimmerText?(text: string, theme?: Theme): string;
  shimmerIntervalMs?: number;
}

const ACTIVITY_API = Symbol.for("pi-activity:api");

export function getActivityApi(): ActivityApi | undefined {
  const api = (globalThis as Record<symbol, unknown>)[ACTIVITY_API] as
    | ActivityApi
    | undefined;
  return api && typeof api.getActivity === "function" ? api : undefined;
}

export function activityRefreshInterval(api: ActivityApi | undefined): number {
  const interval = api?.shimmerIntervalMs;
  return typeof interval === "number" && Number.isFinite(interval) && interval >= 16
    ? Math.min(interval, 1000)
    : 90;
}

export function renderActivityLabel(
  api: ActivityApi | undefined,
  theme: Theme,
  fallbackWorking: boolean,
): string | undefined {
  const activity = api?.getActivity();
  if (!activity?.isWorking && !fallbackWorking) return undefined;
  const label = activity?.label?.trim().replace(/\s+/g, " ") || "working";
  // Pass the live theme through: pi-activity owns the effort-colored sweep.
  return api?.shimmerText
    ? api.shimmerText(label, theme)
    : theme.fg("muted", label);
}
