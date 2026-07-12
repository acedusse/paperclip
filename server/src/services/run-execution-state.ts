// Combo-01 Phase 2c: fleet execution-state helpers + crash-safe panic backstop.
// Pure + dependency-injected, like run-caps.ts.
import type { RunExecutionState } from "@paperclipai/shared";
import type { ReconcileResult, ReconcileSource } from "./admission-reconciler.js";

const SEVERITY: Record<RunExecutionState, number> = { running: 0, draining: 1, halted: 2 };

// Most-severe of the two scopes wins (halted > draining > running).
export function resolveEffectiveExecutionState(
  instance: RunExecutionState,
  company: RunExecutionState,
): RunExecutionState {
  return SEVERITY[instance] >= SEVERITY[company] ? instance : company;
}

export function isQuiescing(state: RunExecutionState): boolean {
  return state !== "running";
}

export type HaltedScope = { kind: "instance" } | { kind: "company"; companyId: string };

export type RunningRunRow = { id: string };

export type PanicHaltSweepDeps = {
  // Ground-truth query: running runs whose effective scope state is "halted".
  findRunningRunsInHaltedScopes(): Promise<RunningRunRow[]>;
  windDownRun(
    runId: string,
    opts: { mode: "hard"; resume: "when-allowed"; reason: "panic" },
  ): Promise<unknown>;
};

// Crash-safe backstop: any run still running under a halted scope is wound down.
// Only "halted" is swept — "draining" intentionally lets in-flight runs finish.
export function makePanicHaltSweepSource(deps: PanicHaltSweepDeps): ReconcileSource {
  return {
    name: "panic-halt-sweep",
    async reconcile(_now: Date): Promise<ReconcileResult> {
      const rows = await deps.findRunningRunsInHaltedScopes();
      let repaired = 0;
      for (const row of rows) {
        await deps.windDownRun(row.id, { mode: "hard", resume: "when-allowed", reason: "panic" });
        repaired += 1;
      }
      return { source: "panic-halt-sweep", drifted: rows.length, repaired };
    },
  };
}
