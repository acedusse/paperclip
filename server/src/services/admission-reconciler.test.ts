/**
 * FILE: server/src/services/admission-reconciler.test.ts
 * ABOUT: admission-reconciler.test.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - admission-reconciler.test.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: admission-reconciler.test.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/admission-reconciler.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it, vi } from "vitest";
import {
  makeRunLivenessSource,
  phase1ReconcileSources,
  RECONCILE_STALE_THRESHOLD_MS,
  runReconcile,
  type ReconcileSource,
} from "./admission-reconciler.js";

describe("runReconcile", () => {
  it("runs every source and returns their results in order", async () => {
    const now = new Date();
    const a: ReconcileSource = {
      name: "a",
      reconcile: async () => ({ source: "a", drifted: 2, repaired: 2 }),
    };
    const b: ReconcileSource = {
      name: "b",
      reconcile: async () => ({ source: "b", drifted: 0, repaired: 0 }),
    };
    expect(await runReconcile([a, b], now)).toEqual([
      { source: "a", drifted: 2, repaired: 2 },
      { source: "b", drifted: 0, repaired: 0 },
    ]);
  });

  it("isolates a throwing source: it is skipped, later sources still run", async () => {
    const boom: ReconcileSource = {
      name: "boom",
      reconcile: async () => {
        throw new Error("kaboom");
      },
    };
    const ran = vi.fn(async () => ({ source: "ok", drifted: 1, repaired: 1 }));
    const ok: ReconcileSource = { name: "ok", reconcile: ran };
    const results = await runReconcile([boom, ok], new Date());
    expect(ran).toHaveBeenCalledOnce();
    expect(results).toEqual([{ source: "ok", drifted: 1, repaired: 1 }]);
  });

  it("passes the shared now to each source", async () => {
    const now = new Date("2026-07-08T00:00:00.000Z");
    const seen: Date[] = [];
    const src: ReconcileSource = {
      name: "s",
      reconcile: async (n) => {
        seen.push(n);
        return { source: "s", drifted: 0, repaired: 0 };
      },
    };
    await runReconcile([src], now);
    expect(seen).toEqual([now]);
  });
});

describe("run-liveness source", () => {
  it("delegates to reapOrphanedRuns with the 5-minute staleness threshold", async () => {
    const reapOrphanedRuns = vi.fn(async () => ({ reaped: 3, runIds: ["a", "b", "c"] }));
    const source = makeRunLivenessSource({ reapOrphanedRuns });
    const result = await source.reconcile(new Date());
    expect(reapOrphanedRuns).toHaveBeenCalledWith({ staleThresholdMs: RECONCILE_STALE_THRESHOLD_MS });
    expect(RECONCILE_STALE_THRESHOLD_MS).toBe(5 * 60 * 1000);
    expect(source.name).toBe("run-liveness");
    expect(result).toEqual({ source: "run-liveness", drifted: 3, repaired: 3 });
  });

  it("reports zero when nothing is reaped", async () => {
    const reapOrphanedRuns = vi.fn(async () => ({ reaped: 0, runIds: [] as string[] }));
    const result = await makeRunLivenessSource({ reapOrphanedRuns }).reconcile(new Date());
    expect(result).toEqual({ source: "run-liveness", drifted: 0, repaired: 0 });
  });

  it("phase1ReconcileSources contains exactly the run-liveness source", async () => {
    const reapOrphanedRuns = vi.fn(async () => ({ reaped: 0, runIds: [] as string[] }));
    const sources = phase1ReconcileSources({ reapOrphanedRuns });
    expect(sources.map((s) => s.name)).toEqual(["run-liveness"]);
  });
});
// [END: module]
