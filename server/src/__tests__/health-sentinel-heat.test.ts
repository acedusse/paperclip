/**
 * FILE: server/src/__tests__/health-sentinel-heat.test.ts
 * ABOUT: health-sentinel-heat.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - health-sentinel-heat.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: health-sentinel-heat.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/health-sentinel-heat.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import type { HealthFinding } from "@paperclipai/shared";
import { rollUpAgentHeat } from "../services/health-sentinel/heat.ts";

function finding(overrides: Partial<HealthFinding>): HealthFinding {
  return {
    kind: "blocker_cycle",
    level: "error",
    summary: "s",
    remediation: "r",
    issueIds: [],
    agentIds: [],
    goalIds: [],
    ...overrides,
  };
}

describe("rollUpAgentHeat", () => {
  it("returns nothing when there are no findings", () => {
    expect(rollUpAgentHeat([], new Map())).toEqual([]);
  });

  it("attributes an issue-level finding to the issue's assignee", () => {
    const heat = rollUpAgentHeat(
      [finding({ issueIds: ["i1"] })],
      new Map([["i1", "a1"]]),
    );

    expect(heat).toHaveLength(1);
    expect(heat[0]!.agentId).toBe("a1");
    expect(heat[0]!.blockedScore).toBe(2);
    expect(heat[0]!.driftScore).toBe(0);
  });

  it("attributes an agent-level finding directly", () => {
    const heat = rollUpAgentHeat(
      [finding({ kind: "agent_error_budget_burned", agentIds: ["a1"] })],
      new Map(),
    );

    expect(heat[0]!.agentId).toBe("a1");
    expect(heat[0]!.blockedScore).toBe(2);
  });

  it("scores drift into a separate channel from blocked pressure", () => {
    const heat = rollUpAgentHeat(
      [
        finding({ kind: "blocker_cycle", level: "error", issueIds: ["i1"] }),
        finding({ kind: "orphan_issue", level: "warn", issueIds: ["i1"] }),
      ],
      new Map([["i1", "a1"]]),
    );

    expect(heat[0]!.blockedScore).toBe(2);
    expect(heat[0]!.driftScore).toBe(1);
  });

  it("weights errors above warnings", () => {
    const heat = rollUpAgentHeat(
      [
        finding({ level: "error", issueIds: ["i1"] }),
        finding({ level: "warn", issueIds: ["i2"] }),
      ],
      new Map([
        ["i1", "a1"],
        ["i2", "a2"],
      ]),
    );

    const a1 = heat.find((h) => h.agentId === "a1")!;
    const a2 = heat.find((h) => h.agentId === "a2")!;
    expect(a1.blockedScore).toBe(2);
    expect(a2.blockedScore).toBe(1);
  });

  it("ignores info-level findings", () => {
    expect(rollUpAgentHeat([finding({ level: "info", issueIds: ["i1"] })], new Map([["i1", "a1"]]))).toEqual([]);
  });

  it("produces no heat for a finding with no agent and no assigned issue", () => {
    // Real finding, but no node to paint it on.
    expect(rollUpAgentHeat([finding({ issueIds: ["i1"] })], new Map([["i1", null]]))).toEqual([]);
  });

  it("spreads a multi-issue finding across every implicated assignee", () => {
    const heat = rollUpAgentHeat(
      [finding({ issueIds: ["i1", "i2"] })],
      new Map([
        ["i1", "a1"],
        ["i2", "a2"],
      ]),
    );

    expect(heat.map((h) => h.agentId).sort()).toEqual(["a1", "a2"]);
  });

  it("counts a finding once per agent even when it names them twice", () => {
    const heat = rollUpAgentHeat(
      [finding({ issueIds: ["i1", "i2"], agentIds: ["a1"] })],
      new Map([
        ["i1", "a1"],
        ["i2", "a1"],
      ]),
    );

    expect(heat).toHaveLength(1);
    expect(heat[0]!.blockedScore).toBe(2);
    expect(heat[0]!.reasons).toEqual(["blocker_cycle"]);
  });

  it("sorts hottest agents first", () => {
    const heat = rollUpAgentHeat(
      [
        finding({ level: "warn", issueIds: ["i1"] }),
        finding({ level: "error", issueIds: ["i2"] }),
        finding({ kind: "orphan_issue", level: "warn", issueIds: ["i2"] }),
      ],
      new Map([
        ["i1", "cool"],
        ["i2", "hot"],
      ]),
    );

    expect(heat[0]!.agentId).toBe("hot");
    expect(heat[1]!.agentId).toBe("cool");
  });

  it("deduplicates reasons", () => {
    const heat = rollUpAgentHeat(
      [finding({ issueIds: ["i1"] }), finding({ issueIds: ["i1"] })],
      new Map([["i1", "a1"]]),
    );

    expect(heat[0]!.reasons).toEqual(["blocker_cycle"]);
    expect(heat[0]!.blockedScore).toBe(4);
  });
});
// [END: module]
