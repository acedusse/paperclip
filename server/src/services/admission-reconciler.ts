/**
 * FILE: server/src/services/admission-reconciler.ts
 * ABOUT: admission-reconciler.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - admission-reconciler.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: admission-reconciler.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/admission-reconciler.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { logger } from "../middleware/logger.js";

// One reconcile source's outcome for a single pass. `drifted` = rows detected
// as diverged from ground truth; `repaired` = rows the source actually fixed.
// (For run-liveness these coincide, since the reaper only reports rows it
// reaped; future sources may detect more than they repair.)
export type ReconcileResult = { source: string; drifted: number; repaired: number };

// A reconcile source owns its own drift detection + repair against ground
// truth. Phase 2 (per-run counters) and Phase 4 (leases) add more sources;
// they plug into runReconcile without touching this loop.
export type ReconcileSource = {
  name: string;
  // Must never throw for "nothing to do"; a throw is treated as a source
  // failure and isolated (logged + skipped) so it can't stop other sources.
  reconcile(now: Date): Promise<ReconcileResult>;
};

// Fault-isolating fold over the sources. Owns no timer and no DB access.
export async function runReconcile(
  sources: ReconcileSource[],
  now: Date,
): Promise<ReconcileResult[]> {
  const results: ReconcileResult[] = [];
  for (const source of sources) {
    try {
      results.push(await source.reconcile(now));
    } catch (err) {
      logger.error({ err, source: source.name }, "reconcile source failed; skipping");
    }
  }
  return results;
}

// The subset of the heartbeat service the run-liveness source needs. Injected
// (not imported) so the reconciler stays free of the heartbeat singleton.
export type ReapOrphanedRuns = (
  opts?: { staleThresholdMs?: number },
) => Promise<{ reaped: number; runIds: string[] }>;

// Same 5-minute staleness threshold today's periodic reaper call uses, so
// wrapping the reaper in the reconciler changes nothing about when runs reap.
export const RECONCILE_STALE_THRESHOLD_MS = 5 * 60 * 1000;

// Phase-1 source: delegates run-liveness reconciliation to the existing,
// battle-tested reaper (real pid / process-group liveness, detached-process
// handling, retry-once). We do not reimplement any of that here.
export function makeRunLivenessSource(deps: { reapOrphanedRuns: ReapOrphanedRuns }): ReconcileSource {
  return {
    name: "run-liveness",
    async reconcile(_now: Date): Promise<ReconcileResult> {
      const { reaped } = await deps.reapOrphanedRuns({ staleThresholdMs: RECONCILE_STALE_THRESHOLD_MS });
      // reapOrphanedRuns only reports rows it reaped, so drifted === repaired here.
      return { source: "run-liveness", drifted: reaped, repaired: reaped };
    },
  };
}

export function phase1ReconcileSources(deps: { reapOrphanedRuns: ReapOrphanedRuns }): ReconcileSource[] {
  return [makeRunLivenessSource(deps)];
}
// [END: module]
