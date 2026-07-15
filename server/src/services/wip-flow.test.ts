import { describe, expect, it } from "vitest";
import { buildAgentWipFlow, computeFlowMetrics, parseWipLimitConfig, wipStatus, isNewStartIssueStatus, newStartBudget, WIP_NEW_START_STATUSES } from "./wip-flow.js";

describe("wipStatus", () => {
  it("reports no limit when disabled", () => {
    expect(wipStatus(4, { enabled: false, maxInProgress: 3 })).toEqual({
      limit: null, current: 4, overBy: 0, overLimit: false,
    });
  });
  it("is under the limit", () => {
    expect(wipStatus(2, { enabled: true, maxInProgress: 3 })).toEqual({
      limit: 3, current: 2, overBy: 0, overLimit: false,
    });
  });
  it("is exactly at the limit (not over)", () => {
    expect(wipStatus(3, { enabled: true, maxInProgress: 3 })).toMatchObject({ overBy: 0, overLimit: false });
  });
  it("is over the limit", () => {
    expect(wipStatus(5, { enabled: true, maxInProgress: 3 })).toEqual({
      limit: 3, current: 5, overBy: 2, overLimit: true,
    });
  });
});

describe("computeFlowMetrics", () => {
  const start = new Date("2026-07-10T00:00:00.000Z");
  it("returns zero throughput and null median for an empty window", () => {
    expect(computeFlowMetrics([])).toEqual({ throughputLast7d: 0, medianCycleTimeMs: null });
  });
  it("computes throughput and median cycle time (odd count)", () => {
    const rows = [
      { startedAt: start, completedAt: new Date(start.getTime() + 1000) },
      { startedAt: start, completedAt: new Date(start.getTime() + 3000) },
      { startedAt: start, completedAt: new Date(start.getTime() + 2000) },
    ];
    expect(computeFlowMetrics(rows)).toEqual({ throughputLast7d: 3, medianCycleTimeMs: 2000 });
  });
  it("averages the two middle cycle times (even count)", () => {
    const rows = [
      { startedAt: start, completedAt: new Date(start.getTime() + 1000) },
      { startedAt: start, completedAt: new Date(start.getTime() + 3000) },
    ];
    expect(computeFlowMetrics(rows).medianCycleTimeMs).toBe(2000);
  });
  it("counts throughput but skips a row with no startedAt for cycle time", () => {
    const rows = [
      { startedAt: null, completedAt: new Date(start.getTime() + 5000) },
      { startedAt: start, completedAt: new Date(start.getTime() + 1000) },
    ];
    expect(computeFlowMetrics(rows)).toEqual({ throughputLast7d: 2, medianCycleTimeMs: 1000 });
  });
});

describe("parseWipLimitConfig / buildAgentWipFlow", () => {
  it("reads runtimeConfig.heartbeat.wipLimit", () => {
    expect(parseWipLimitConfig({ heartbeat: { wipLimit: { enabled: true, maxInProgress: 2 } } })).toEqual({
      enabled: true, maxInProgress: 2,
    });
  });
  it("falls back to defaults for an absent config", () => {
    expect(parseWipLimitConfig(null)).toEqual({ enabled: false, maxInProgress: 3 });
  });
  it("assembles wip + flow fields", () => {
    const result = buildAgentWipFlow({ heartbeat: { wipLimit: { enabled: true, maxInProgress: 1 } } }, 2, []);
    expect(result).toEqual({
      wip: { limit: 1, current: 2, overBy: 1, overLimit: true },
      flow: { throughputLast7d: 0, medianCycleTimeMs: null },
    });
  });
});

describe("isNewStartIssueStatus", () => {
  it("is true only for checkout-eligible statuses", () => {
    for (const s of ["todo", "backlog", "blocked"]) expect(isNewStartIssueStatus(s)).toBe(true);
    for (const s of ["in_progress", "in_review", "done", "cancelled"]) expect(isNewStartIssueStatus(s)).toBe(false);
  });
  it("is false for null/undefined (non-issue runs)", () => {
    expect(isNewStartIssueStatus(null)).toBe(false);
    expect(isNewStartIssueStatus(undefined)).toBe(false);
  });
  it("exposes the exact status set", () => {
    expect([...WIP_NEW_START_STATUSES].sort()).toEqual(["backlog", "blocked", "todo"]);
  });
});

describe("newStartBudget", () => {
  it("is Infinity when disabled (opt-in parity)", () => {
    expect(newStartBudget({ enabled: false, maxInProgress: 3 }, 99)).toBe(Infinity);
  });
  it("is the remaining headroom when enabled", () => {
    expect(newStartBudget({ enabled: true, maxInProgress: 3 }, 1)).toBe(2);
    expect(newStartBudget({ enabled: true, maxInProgress: 3 }, 3)).toBe(0);
    expect(newStartBudget({ enabled: true, maxInProgress: 3 }, 5)).toBe(0);
  });
});
