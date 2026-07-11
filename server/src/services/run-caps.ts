// Combo-01 Phase 2a: per-run resource-cap logic. Pure + dependency-injected,
// like run-wind-down.ts. Enforcement terminates via the injected windDownRun.
import type { ReconcileResult, ReconcileSource } from "./admission-reconciler.js";

export type RunCaps = { maxRunWallClockMs: number | null; maxRunCostCents: number | null };
export type RunCapReason = "cap-wallclock" | "cap-cost";
export type RunCapViolation = { runId: string; reason: RunCapReason };

// A running run with its stamped ceilings + wall-clock baseline.
export type RunningRunCapRow = {
  id: string;
  startedAt: Date | null;
  maxRunWallClockMs: number | null;
  maxRunCostCents: number | null;
};

// company overrides instance, per field. null = unlimited.
export function resolveRunCaps(input: { company: RunCaps; instance: RunCaps }): RunCaps {
  return {
    maxRunWallClockMs: input.company.maxRunWallClockMs ?? input.instance.maxRunWallClockMs,
    maxRunCostCents: input.company.maxRunCostCents ?? input.instance.maxRunCostCents,
  };
}

export function isWallClockExceeded(row: RunningRunCapRow, now: Date): boolean {
  if (row.maxRunWallClockMs == null || !row.startedAt) return false;
  return now.getTime() - row.startedAt.getTime() > row.maxRunWallClockMs;
}

export type RunCostCapDeps = {
  getStampedCostCap(runId: string): Promise<number | null>;
  sumRunCostCents(runId: string): Promise<number>;
};

// Reactive path: is this run over its stamped cost cap right now?
export async function evaluateRunCostCap(deps: RunCostCapDeps, runId: string): Promise<RunCapViolation | null> {
  const cap = await deps.getStampedCostCap(runId);
  if (cap == null) return null;
  const spent = await deps.sumRunCostCents(runId);
  return spent > cap ? { runId, reason: "cap-cost" } : null;
}

export type RunCapSweepDeps = {
  findRunningRunsWithCaps(): Promise<RunningRunCapRow[]>;
  sumRunCostCents(runId: string): Promise<number>;
  windDownRun(
    runId: string,
    opts: { mode: "hard"; resume: "when-allowed"; reason: RunCapReason },
  ): Promise<unknown>;
};

// Periodic sweep + crash-safe backstop for BOTH caps. Wall-clock is checked
// first (cheap, no query); cost only when wall-clock is fine and a cap is set.
export function makeRunCapSweepSource(deps: RunCapSweepDeps): ReconcileSource {
  return {
    name: "run-cap-sweep",
    async reconcile(now: Date): Promise<ReconcileResult> {
      const rows = await deps.findRunningRunsWithCaps();
      let drifted = 0;
      let repaired = 0;
      for (const row of rows) {
        let reason: RunCapReason | null = null;
        if (isWallClockExceeded(row, now)) {
          reason = "cap-wallclock";
        } else if (row.maxRunCostCents != null && (await deps.sumRunCostCents(row.id)) > row.maxRunCostCents) {
          reason = "cap-cost";
        }
        if (!reason) continue;
        drifted += 1;
        await deps.windDownRun(row.id, { mode: "hard", resume: "when-allowed", reason });
        repaired += 1;
      }
      return { source: "run-cap-sweep", drifted, repaired };
    },
  };
}
