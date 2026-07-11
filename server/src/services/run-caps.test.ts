import { describe, expect, it, vi } from "vitest";
import {
  evaluateRunCostCap,
  isWallClockExceeded,
  makeRunCapSweepSource,
  resolveRunCaps,
  type RunningRunCapRow,
} from "./run-caps.js";

describe("resolveRunCaps", () => {
  it("company overrides instance per field", () => {
    expect(
      resolveRunCaps({
        company: { maxRunWallClockMs: 1000, maxRunCostCents: null },
        instance: { maxRunWallClockMs: 9999, maxRunCostCents: 500 },
      }),
    ).toEqual({ maxRunWallClockMs: 1000, maxRunCostCents: 500 });
  });

  it("both null => unlimited", () => {
    expect(
      resolveRunCaps({
        company: { maxRunWallClockMs: null, maxRunCostCents: null },
        instance: { maxRunWallClockMs: null, maxRunCostCents: null },
      }),
    ).toEqual({ maxRunWallClockMs: null, maxRunCostCents: null });
  });
});

describe("isWallClockExceeded", () => {
  const base: RunningRunCapRow = { id: "r", startedAt: new Date("2026-07-11T00:00:00Z"), maxRunWallClockMs: 60000, maxRunCostCents: null };
  it("true when elapsed exceeds the cap", () => {
    expect(isWallClockExceeded(base, new Date("2026-07-11T00:01:01Z"))).toBe(true);
  });
  it("false when within the cap", () => {
    expect(isWallClockExceeded(base, new Date("2026-07-11T00:00:30Z"))).toBe(false);
  });
  it("false when no cap or no startedAt", () => {
    expect(isWallClockExceeded({ ...base, maxRunWallClockMs: null }, new Date())).toBe(false);
    expect(isWallClockExceeded({ ...base, startedAt: null }, new Date())).toBe(false);
  });
});

describe("evaluateRunCostCap", () => {
  it("violation when spend exceeds the stamped cap", async () => {
    const deps = { getStampedCostCap: vi.fn(async () => 500), sumRunCostCents: vi.fn(async () => 501) };
    expect(await evaluateRunCostCap(deps, "r1")).toEqual({ runId: "r1", reason: "cap-cost" });
  });
  it("null when within the cap", async () => {
    const deps = { getStampedCostCap: vi.fn(async () => 500), sumRunCostCents: vi.fn(async () => 500) };
    expect(await evaluateRunCostCap(deps, "r1")).toBeNull();
  });
  it("null (and no sum query) when the cap is unset", async () => {
    const sumRunCostCents = vi.fn(async () => 9999);
    expect(await evaluateRunCostCap({ getStampedCostCap: vi.fn(async () => null), sumRunCostCents }, "r1")).toBeNull();
    expect(sumRunCostCents).not.toHaveBeenCalled();
  });
});

describe("makeRunCapSweepSource", () => {
  const now = new Date("2026-07-11T01:00:00Z");
  it("winds down a wall-clock violator with cap-wallclock", async () => {
    const rows: RunningRunCapRow[] = [
      { id: "old", startedAt: new Date("2026-07-11T00:00:00Z"), maxRunWallClockMs: 60000, maxRunCostCents: null },
    ];
    const windDownRun = vi.fn(async () => ({ outcome: "terminated" }));
    const source = makeRunCapSweepSource({
      findRunningRunsWithCaps: vi.fn(async () => rows),
      sumRunCostCents: vi.fn(async () => 0),
      windDownRun,
    });
    const result = await source.reconcile(now);
    expect(windDownRun).toHaveBeenCalledWith("old", { mode: "hard", resume: "when-allowed", reason: "cap-wallclock" });
    expect(result).toEqual({ source: "run-cap-sweep", drifted: 1, repaired: 1 });
  });

  it("winds down a cost violator with cap-cost when wall-clock is fine", async () => {
    const rows: RunningRunCapRow[] = [
      { id: "spendy", startedAt: now, maxRunWallClockMs: null, maxRunCostCents: 100 },
    ];
    const windDownRun = vi.fn(async () => ({ outcome: "terminated" }));
    const source = makeRunCapSweepSource({
      findRunningRunsWithCaps: vi.fn(async () => rows),
      sumRunCostCents: vi.fn(async () => 150),
      windDownRun,
    });
    const result = await source.reconcile(now);
    expect(windDownRun).toHaveBeenCalledWith("spendy", { mode: "hard", resume: "when-allowed", reason: "cap-cost" });
    expect(result).toEqual({ source: "run-cap-sweep", drifted: 1, repaired: 1 });
  });

  it("leaves compliant runs alone", async () => {
    const rows: RunningRunCapRow[] = [{ id: "ok", startedAt: now, maxRunWallClockMs: 60000, maxRunCostCents: 100 }];
    const windDownRun = vi.fn(async () => ({ outcome: "terminated" }));
    const source = makeRunCapSweepSource({
      findRunningRunsWithCaps: vi.fn(async () => rows),
      sumRunCostCents: vi.fn(async () => 10),
      windDownRun,
    });
    expect(await source.reconcile(now)).toEqual({ source: "run-cap-sweep", drifted: 0, repaired: 0 });
    expect(windDownRun).not.toHaveBeenCalled();
  });
});
