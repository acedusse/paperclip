import { describe, it, expect } from "vitest";
import { canDecide, METHOD_PRECEDENCE } from "./approval-authority.js";

describe("canDecide", () => {
  it("locks the precedence order", () => {
    expect(METHOD_PRECEDENCE).toEqual(["explicit_human", "delegated_human", "coverage_escalation", "bounded_agent", "auto_policy"]);
  });
  it("allows explicit_human at any band", () => {
    expect(canDecide({ band: "critical", method: "explicit_human" }).allow).toBe(true);
  });
  it("denies every non-registered method", () => {
    for (const m of ["delegated_human", "coverage_escalation", "bounded_agent"] as const) {
      expect(canDecide({ band: "low", method: m }).allow).toBe(false);
    }
  });
  it("denies non-human methods above autoDecisionMaxBand (guards the hard rule)", () => {
    const r = canDecide({ band: "high", method: "auto_policy", autoDecisionMaxBand: "low" });
    expect(r.allow).toBe(false);
    expect(r.deny).toMatch(/band/i);
  });
});

describe("canDecide — auto_policy (phase 2a)", () => {
  it("allows auto_policy at or below the max band", () => {
    expect(canDecide({ band: "low", method: "auto_policy", autoDecisionMaxBand: "low" }).allow).toBe(true);
  });
  it("still denies auto_policy above the max band", () => {
    const r = canDecide({ band: "medium", method: "auto_policy", autoDecisionMaxBand: "low" });
    expect(r.allow).toBe(false);
    expect(r.deny).toMatch(/band/i);
  });
  it("leaves explicit_human unaffected", () => {
    expect(canDecide({ band: "critical", method: "explicit_human" }).allow).toBe(true);
  });
});
