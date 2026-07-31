/**
 * FILE: ui/src/lib/preflight-display.test.ts
 * ABOUT: preflight-display.test.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - preflight-display.test.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: preflight-display.test.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/preflight-display.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import type { PreflightFinding, PreflightReport } from "@paperclipai/shared";
import {
  groupFindingsByLevel,
  levelBadgeClass,
  levelLabel,
  statusSummary,
} from "./preflight-display";

const finding = (overrides: Partial<PreflightFinding>): PreflightFinding => ({
  code: "agent_without_work",
  level: "warn",
  message: "m",
  hint: "h",
  agentIds: [],
  ...overrides,
});

const report = (overrides: Partial<PreflightReport>): PreflightReport => ({
  companyId: "c1",
  generatedAt: "2026-07-31T12:00:00.000Z",
  status: "pass",
  findings: [],
  projection: {
    agentCount: 0,
    cycles: 0,
    lowCents: 0,
    expectedCents: 0,
    highCents: 0,
    confidence: "none",
    basis: "No cost history yet.",
  },
  ...overrides,
});

describe("statusSummary", () => {
  it("shows a loading state before the report arrives", () => {
    const summary = statusSummary(undefined);
    expect(summary.label).toBe("Checking…");
    expect(summary.blocking).toBe(false);
  });

  it("reports a clean company as ready", () => {
    const summary = statusSummary(report({ status: "pass" }));
    expect(summary.label).toBe("Ready to launch");
    expect(summary.dotClass).toContain("emerald");
    expect(summary.blocking).toBe(false);
  });

  it("marks a failing report as blocking and counts the errors", () => {
    const summary = statusSummary(
      report({
        status: "fail",
        findings: [finding({ level: "error" }), finding({ level: "error" }), finding({ level: "warn" })],
      }),
    );

    expect(summary.blocking).toBe(true);
    expect(summary.detail).toContain("2 blocking problems");
    expect(summary.dotClass).toContain("red");
  });

  it("uses the singular for exactly one blocking problem", () => {
    const summary = statusSummary(report({ status: "fail", findings: [finding({ level: "error" })] }));
    expect(summary.detail).toContain("1 blocking problem must");
  });

  it("treats warnings as non-blocking", () => {
    const summary = statusSummary(report({ status: "warn", findings: [finding({ level: "warn" })] }));
    expect(summary.blocking).toBe(false);
    expect(summary.detail).toContain("1 thing is");
    expect(summary.dotClass).toContain("amber");
  });

  it("uses the plural for multiple warnings", () => {
    const summary = statusSummary(
      report({ status: "warn", findings: [finding({ level: "warn" }), finding({ level: "warn" })] }),
    );
    expect(summary.detail).toContain("2 things are");
  });
});

describe("levelLabel and levelBadgeClass", () => {
  it("labels each level in operator language, not the raw code", () => {
    expect(levelLabel("error")).toBe("Blocking");
    expect(levelLabel("warn")).toBe("Warning");
    expect(levelLabel("info")).toBe("Info");
  });

  it("gives each level a distinct badge style", () => {
    const classes = new Set([levelBadgeClass("error"), levelBadgeClass("warn"), levelBadgeClass("info")]);
    expect(classes.size).toBe(3);
  });
});

describe("groupFindingsByLevel", () => {
  it("returns nothing for an empty report", () => {
    expect(groupFindingsByLevel([])).toEqual([]);
  });

  it("orders errors before warnings before info regardless of input order", () => {
    const groups = groupFindingsByLevel([
      finding({ level: "info" }),
      finding({ level: "warn" }),
      finding({ level: "error" }),
    ]);

    expect(groups.map((group) => group.level)).toEqual(["error", "warn", "info"]);
  });

  it("omits levels with no findings", () => {
    const groups = groupFindingsByLevel([finding({ level: "error" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.level).toBe("error");
  });

  it("keeps every finding", () => {
    const input = [finding({ level: "error" }), finding({ level: "error" }), finding({ level: "info" })];
    const total = groupFindingsByLevel(input).reduce((sum, group) => sum + group.findings.length, 0);
    expect(total).toBe(3);
  });
});
// [END: module]
