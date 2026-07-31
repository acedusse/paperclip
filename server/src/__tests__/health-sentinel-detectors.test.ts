/**
 * FILE: server/src/__tests__/health-sentinel-detectors.test.ts
 * ABOUT: health-sentinel-detectors.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - health-sentinel-detectors.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: health-sentinel-detectors.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/health-sentinel-detectors.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import type { AgentRunSignals } from "@paperclipai/shared";
import {
  detectGoalDrift,
  findOrphanIssues,
  resolveIssueGoalId,
  type DriftGoal,
  type DriftIssue,
} from "../services/health-sentinel/goal-drift.ts";
import {
  detectDecompositionGaps,
  type DecompositionRecord,
} from "../services/health-sentinel/decomposition.ts";
import {
  detectReliabilityBreaches,
  DEFAULT_RELIABILITY_SLO,
} from "../services/health-sentinel/reliability.ts";

function issue(overrides: Partial<DriftIssue> & { id: string }): DriftIssue {
  return {
    identifier: overrides.id.toUpperCase(),
    status: "todo",
    parentId: null,
    goalId: null,
    ...overrides,
  };
}

const liveGoal: DriftGoal = { id: "g1", title: "Ship v1", status: "active", level: "company" };
const deadGoal: DriftGoal = { id: "g2", title: "Old bet", status: "cancelled", level: "company" };

describe("resolveIssueGoalId", () => {
  it("inherits the goal from an ancestor", () => {
    const parent = issue({ id: "p", goalId: "g1" });
    const child = issue({ id: "c", parentId: "p" });
    const byId = new Map([parent, child].map((i) => [i.id, i]));

    expect(resolveIssueGoalId(child, byId)).toBe("g1");
  });

  it("prefers the issue's own goal over an ancestor's", () => {
    const parent = issue({ id: "p", goalId: "g1" });
    const child = issue({ id: "c", parentId: "p", goalId: "g2" });
    const byId = new Map([parent, child].map((i) => [i.id, i]));

    expect(resolveIssueGoalId(child, byId)).toBe("g2");
  });

  it("returns null on a broken parent link", () => {
    const child = issue({ id: "c", parentId: "missing" });
    expect(resolveIssueGoalId(child, new Map([[child.id, child]]))).toBeNull();
  });

  it("returns null rather than looping on a cyclic parent chain", () => {
    const a = issue({ id: "a", parentId: "b" });
    const b = issue({ id: "b", parentId: "a" });
    const byId = new Map([a, b].map((i) => [i.id, i]));

    expect(resolveIssueGoalId(a, byId)).toBeNull();
  });
});

describe("findOrphanIssues", () => {
  it("does not flag open work under a live goal", () => {
    const issues = [issue({ id: "a", goalId: "g1" })];
    expect(findOrphanIssues(issues, [liveGoal])).toEqual([]);
  });

  it("does not flag a healthy sub-tree that inherits its goal", () => {
    const issues = [issue({ id: "p", goalId: "g1" }), issue({ id: "c", parentId: "p" })];
    expect(findOrphanIssues(issues, [liveGoal])).toEqual([]);
  });

  it("flags open work with no goal anywhere in its chain", () => {
    const issues = [issue({ id: "a" })];
    expect(findOrphanIssues(issues, [liveGoal])).toEqual([
      { issueId: "a", reason: "no_goal", goalId: null },
    ]);
  });

  it("flags open work serving a cancelled goal", () => {
    const issues = [issue({ id: "a", goalId: "g2" })];
    expect(findOrphanIssues(issues, [liveGoal, deadGoal])).toEqual([
      { issueId: "a", reason: "dead_goal", goalId: "g2" },
    ]);
  });

  it("ignores completed work", () => {
    const issues = [issue({ id: "a", status: "done" }), issue({ id: "b", status: "cancelled" })];
    expect(findOrphanIssues(issues, [liveGoal])).toEqual([]);
  });
});

describe("detectGoalDrift", () => {
  it("reports an empty company-level goal", () => {
    const findings = detectGoalDrift([], [liveGoal]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("goal_without_work");
    expect(findings[0]!.goalIds).toEqual(["g1"]);
  });

  it("does not report empty task-level goals as a problem", () => {
    const taskGoal: DriftGoal = { id: "g3", title: "Sub", status: "active", level: "task" };
    expect(detectGoalDrift([], [taskGoal])).toEqual([]);
  });

  it("does not report a goal that has open work", () => {
    expect(detectGoalDrift([issue({ id: "a", goalId: "g1" })], [liveGoal])).toEqual([]);
  });

  it("names the issue to re-parent in the remediation", () => {
    const findings = detectGoalDrift([issue({ id: "a" })], []);
    const orphan = findings.find((f) => f.kind === "orphan_issue");
    expect(orphan!.remediation).toContain("A");
    expect(orphan!.level).toBe("warn");
  });
});

describe("detectDecompositionGaps", () => {
  const record = (overrides: Partial<DecompositionRecord>): DecompositionRecord => ({
    id: "d1",
    sourceIssueId: "i1",
    sourceIssueIdentifier: "ACME-1",
    status: "completed",
    requestedChildCount: 3,
    childIssueIds: ["c1", "c2", "c3"],
    ...overrides,
  });

  it("passes a decomposition that produced what it promised", () => {
    expect(detectDecompositionGaps([record({})])).toEqual([]);
  });

  it("warns when fewer children were created than requested", () => {
    const findings = detectDecompositionGaps([record({ childIssueIds: ["c1"] })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.level).toBe("warn");
    expect(findings[0]!.summary).toContain("2 missing");
  });

  it("errors when the plan was accepted but produced nothing", () => {
    const findings = detectDecompositionGaps([record({ childIssueIds: [] })]);
    expect(findings[0]!.level).toBe("error");
    expect(findings[0]!.remediation).toContain("Re-run decomposition");
  });

  it("ignores in-flight decompositions still creating children", () => {
    expect(detectDecompositionGaps([record({ status: "in_flight", childIssueIds: [] })])).toEqual([]);
  });

  it("ignores records that requested no children", () => {
    expect(
      detectDecompositionGaps([record({ requestedChildCount: 0, childIssueIds: [] })]),
    ).toEqual([]);
  });

  it("does not flag over-delivery", () => {
    expect(
      detectDecompositionGaps([record({ requestedChildCount: 2, childIssueIds: ["a", "b", "c"] })]),
    ).toEqual([]);
  });
});

describe("detectReliabilityBreaches", () => {
  const agent = { id: "a1", name: "Coder" };
  const signals = (overrides: Partial<AgentRunSignals>): Map<string, AgentRunSignals> =>
    new Map([
      [
        "a1",
        { agentId: "a1", runCount: 20, succeededCount: 18, failedCount: 2, retriedRunCount: 0, ...overrides },
      ],
    ]);

  it("passes an agent inside its error budget", () => {
    expect(detectReliabilityBreaches([agent], signals({}))).toEqual([]);
  });

  it("flags an agent over its error budget", () => {
    const findings = detectReliabilityBreaches([agent], signals({ succeededCount: 10, failedCount: 10 }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("agent_error_budget_burned");
    expect(findings[0]!.agentIds).toEqual(["a1"]);
    expect(findings[0]!.summary).toContain("50%");
  });

  it("does not fire below the minimum sample, however bad the rate", () => {
    // 1 of 1 failed is 100% — and meaningless.
    const findings = detectReliabilityBreaches([agent], signals({ succeededCount: 0, failedCount: 1 }));
    expect(findings).toEqual([]);
  });

  it("treats a rate exactly at the budget as passing", () => {
    const findings = detectReliabilityBreaches([agent], signals({ succeededCount: 16, failedCount: 4 }));
    expect(findings).toEqual([]);
  });

  it("ignores in-flight runs when sizing the sample", () => {
    // 40 runs total but only 5 terminal — below the minimum sample.
    const findings = detectReliabilityBreaches(
      [agent],
      signals({ runCount: 40, succeededCount: 0, failedCount: 5 }),
    );
    expect(findings).toEqual([]);
  });

  it("skips agents with no signals", () => {
    expect(detectReliabilityBreaches([agent], new Map())).toEqual([]);
  });

  it("honours a custom SLO", () => {
    const strict = { errorBudget: 0.05, minimumSample: DEFAULT_RELIABILITY_SLO.minimumSample };
    const findings = detectReliabilityBreaches([agent], signals({}), strict);
    expect(findings).toHaveLength(1);
  });
});
// [END: module]
