import { describe, expect, it } from "vitest";
import {
  BREAKER,
  classifyDownLevel,
  computeTimeToLimit,
  evaluateCompanyBreaker,
  nextLevelWithHysteresis,
  type BreakerEvalDeps,
} from "./predictive-breaker.js";
import type { BreakerLevel } from "@paperclipai/shared";

const H = 40; // horizon minutes -> halt<=10, throttle<=40, warn<=80
const T0 = new Date("2026-07-12T00:00:00Z");
const afterDwell = new Date(T0.getTime() + BREAKER.minDwellMs + 1);
const beforeDwell = new Date(T0.getTime() + BREAKER.minDwellMs - 1);

describe("computeTimeToLimit", () => {
  it("is Infinity when not burning", () => {
    expect(computeTimeToLimit(1000, 0)).toBe(Infinity);
  });
  it("is 0 when remaining is exhausted", () => {
    expect(computeTimeToLimit(0, 5)).toBe(0);
    expect(computeTimeToLimit(-10, 5)).toBe(0);
  });
  it("is remaining / burnRate in minutes otherwise", () => {
    expect(computeTimeToLimit(100, 5)).toBe(20);
  });
});

describe("classifyDownLevel", () => {
  it("maps timeToLimit to the right rung", () => {
    expect(classifyDownLevel(200, H)).toBe("normal"); // > 2H (80)
    expect(classifyDownLevel(70, H)).toBe("warn"); // <= 2H, > H
    expect(classifyDownLevel(30, H)).toBe("throttle"); // <= H, > H/4
    expect(classifyDownLevel(5, H)).toBe("halt"); // <= H/4 (10)
    expect(classifyDownLevel(0, H)).toBe("halt"); // exhausted
  });
});

describe("nextLevelWithHysteresis", () => {
  it("escalates immediately, jumping multiple rungs", () => {
    expect(nextLevelWithHysteresis("normal", T0, 5, H, afterDwell)).toBe("halt");
  });
  it("does not de-escalate before min dwell even when recovered", () => {
    // tt=200 (fully recovered) but only 'beforeDwell' has elapsed
    expect(nextLevelWithHysteresis("throttle", T0, 200, H, beforeDwell)).toBe("throttle");
  });
  it("does not de-escalate until timeToLimit clears the gapped up-threshold", () => {
    // throttle->warn needs tt > H*upGap = 60; here tt=50 (still <=60) though dwell met
    expect(nextLevelWithHysteresis("throttle", T0, 50, H, afterDwell)).toBe("throttle");
  });
  it("de-escalates ONE rung when dwell met and tt clears the gap", () => {
    // throttle->warn: tt > 60 and dwell met -> warn (not straight to normal)
    expect(nextLevelWithHysteresis("throttle", T0, 200, H, afterDwell)).toBe("warn");
  });
  it("de-escalates halt->throttle first", () => {
    // halt->throttle needs tt > (H/4)*upGap = 15; tt=200, dwell met
    expect(nextLevelWithHysteresis("halt", T0, 200, H, afterDwell)).toBe("throttle");
  });
  it("holds when the raw level equals the current level", () => {
    expect(nextLevelWithHysteresis("throttle", T0, 30, H, afterDwell)).toBe("throttle");
  });
});

function fakeDeps(over: Partial<BreakerEvalDeps> & {
  burn?: number;
  remaining?: number | null;
  state?: { level: BreakerLevel; since: Date } | null;
}): { deps: BreakerEvalDeps; saved: Array<{ level: BreakerLevel }>; wound: string[]; logs: Array<[BreakerLevel, BreakerLevel]> } {
  const saved: Array<{ level: BreakerLevel }> = [];
  const wound: string[] = [];
  const logs: Array<[BreakerLevel, BreakerLevel]> = [];
  const deps: BreakerEvalDeps = {
    getBurnRateCentsPerMin: async () => over.burn ?? 0,
    getMostUrgentRemainingCents: async () => (over.remaining === undefined ? 1000 : over.remaining),
    loadState: async () => over.state ?? null,
    saveState: async (_c, row) => {
      saved.push({ level: row.level });
    },
    windDownCompanyRuns: async (companyId) => {
      wound.push(companyId);
    },
    logTransition: async (_c, from, to) => {
      logs.push([from, to]);
    },
    ...over,
  };
  return { deps, saved, wound, logs };
}

describe("evaluateCompanyBreaker", () => {
  it("returns normal and does not wind down when not burning", async () => {
    const { deps, wound } = fakeDeps({ burn: 0, remaining: 1000 });
    const level = await evaluateCompanyBreaker(deps, "c1", 40, T0);
    expect(level).toBe("normal");
    expect(wound).toEqual([]);
  });

  it("escalates to halt and winds down when the budget is nearly gone", async () => {
    // remaining 10, burn 5/min -> tt=2 <= H/4(10) -> halt
    const { deps, wound, logs } = fakeDeps({ burn: 5, remaining: 10 });
    const level = await evaluateCompanyBreaker(deps, "c1", 40, T0);
    expect(level).toBe("halt");
    expect(wound).toEqual(["c1"]);
    expect(logs).toContainEqual(["normal", "halt"]);
  });

  it("winds down every tick while halted (idempotent backstop)", async () => {
    const { deps, wound } = fakeDeps({ burn: 5, remaining: 10, state: { level: "halt", since: T0 } });
    await evaluateCompanyBreaker(deps, "c1", 40, new Date(T0.getTime() + 60_000));
    expect(wound).toEqual(["c1"]); // still winds down while the level stays halt
  });

  it("resets to normal and skips wind-down when the company is ineligible", async () => {
    const { deps, wound } = fakeDeps({ remaining: null, state: { level: "throttle", since: T0 } });
    const level = await evaluateCompanyBreaker(deps, "c1", 40, T0);
    expect(level).toBe("normal");
    expect(wound).toEqual([]);
  });
});
