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
// [END: module]
