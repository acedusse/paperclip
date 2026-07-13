import { describe, it, expect } from "vitest";
import { canDecide, METHOD_PRECEDENCE } from "./approval-authority.js";

describe("canDecide", () => {
  it("locks the precedence order", () => {
    expect(METHOD_PRECEDENCE).toEqual(["explicit_human", "delegated_human", "coverage_escalation", "bounded_agent", "auto_policy"]);
  });
  it("allows explicit_human at any band", () => {
    expect(canDecide({ band: "critical", method: "explicit_human" }).allow).toBe(true);
  });
  it("denies every non-registered method in phase 1", () => {
    for (const m of ["delegated_human", "coverage_escalation", "bounded_agent", "auto_policy"] as const) {
      expect(canDecide({ band: "low", method: m }).allow).toBe(false);
    }
  });
  it("denies non-human methods above autoDecisionMaxBand (guards the hard rule)", () => {
    const r = canDecide({ band: "high", method: "auto_policy", autoDecisionMaxBand: "low" });
    expect(r.allow).toBe(false);
    expect(r.deny).toMatch(/band/i);
  });
});
