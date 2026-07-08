import { describe, expect, it, vi } from "vitest";
import { runReconcile, type ReconcileSource } from "./admission-reconciler.js";

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
