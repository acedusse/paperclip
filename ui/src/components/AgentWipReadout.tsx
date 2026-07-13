/**
 * FILE: ui/src/components/AgentWipReadout.tsx
 * ABOUT: AgentWipReadout.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - AgentWipReadout.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: AgentWipReadout.tsx (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/AgentWipReadout.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { formatDurationMs } from "../lib/utils";

export interface AgentWipReadoutProps {
  /** Combo-01 Phase 4A-ii: in-progress load vs limit (read-only; set by the read path). */
  wip: { limit: number | null; current: number; overBy: number; overLimit: boolean };
  /** Combo-01 Phase 4A-ii: trailing-7d flow metrics (read-only; set by the read path). */
  flow: { throughputLast7d: number; medianCycleTimeMs: number | null };
}

/**
 * Compact per-agent WIP + flow readout. Shows in-progress load against the
 * configured limit (with a warning when over), plus trailing-7d throughput and
 * median cycle time. Agents without a limit read `WIP N` with no cap; the
 * limit/warning only appears once an operator opts in (Combo-01 Phase 4A-ii).
 */
export function AgentWipReadout({ wip, flow }: AgentWipReadoutProps) {
  const cycle = flow.medianCycleTimeMs === null ? "—" : formatDurationMs(flow.medianCycleTimeMs);
  const load = wip.limit === null ? `WIP ${wip.current}` : `WIP ${wip.current} / ${wip.limit}`;
  return (
    <span className={`text-xs ${wip.overLimit ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"}`}>
      {load}{wip.overLimit ? " ⚠" : ""} · {flow.throughputLast7d}/wk · {cycle}
    </span>
  );
}
// [END: module]
