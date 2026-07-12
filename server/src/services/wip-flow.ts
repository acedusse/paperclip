import { wipLimitSchema, type WipLimitConfig } from "@paperclipai/shared";

export interface WipStatus {
  limit: number | null;
  current: number;
  overBy: number;
  overLimit: boolean;
}

export interface FlowMetrics {
  throughputLast7d: number;
  medianCycleTimeMs: number | null;
}

export interface WipFlowFields {
  wip: WipStatus;
  flow: FlowMetrics;
}

/** Parse just the WIP-limit fields from an agent's runtimeConfig blob. */
export function parseWipLimitConfig(runtimeConfig: unknown): WipLimitConfig {
  const hb = (runtimeConfig as { heartbeat?: Record<string, unknown> } | null)?.heartbeat ?? {};
  return wipLimitSchema.parse(hb.wipLimit ?? {});
}

/** Current in-progress load vs the configured cap. Disabled → no limit, never over. */
export function wipStatus(current: number, cfg: WipLimitConfig): WipStatus {
  if (!cfg.enabled) return { limit: null, current, overBy: 0, overLimit: false };
  const overBy = Math.max(0, current - cfg.maxInProgress);
  return { limit: cfg.maxInProgress, current, overBy, overLimit: overBy > 0 };
}

/** Median of a numeric array (sorted copy); null on empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Flow metrics over issues the agent COMPLETED in the (SQL-windowed) trailing
 * 7 days. Throughput is the row count; cycle time is the median of
 * completedAt − startedAt, skipping rows that never recorded a start.
 */
export function computeFlowMetrics(rows: { startedAt: Date | null; completedAt: Date }[]): FlowMetrics {
  const cycleTimes = rows
    .filter((r): r is { startedAt: Date; completedAt: Date } => r.startedAt !== null)
    .map((r) => r.completedAt.getTime() - r.startedAt.getTime())
    .filter((ms) => ms >= 0);
  return { throughputLast7d: rows.length, medianCycleTimeMs: median(cycleTimes) };
}

/** Assemble the { wip, flow } fields attached to an agent read/list response. */
export function buildAgentWipFlow(
  runtimeConfig: unknown,
  current: number,
  completions: { startedAt: Date | null; completedAt: Date }[],
): WipFlowFields {
  return {
    wip: wipStatus(current, parseWipLimitConfig(runtimeConfig)),
    flow: computeFlowMetrics(completions),
  };
}
