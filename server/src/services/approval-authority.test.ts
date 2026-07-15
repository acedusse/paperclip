import { describe, it, expect } from "vitest";
import { canDecide, canDecideUnderDelegation, METHOD_PRECEDENCE } from "./approval-authority.js";

describe("canDecide", () => {
  it("locks the precedence order", () => {
    expect(METHOD_PRECEDENCE).toEqual(["explicit_human", "delegated_human", "coverage_escalation", "bounded_agent", "auto_policy"]);
  });
  it("allows explicit_human at any band", () => {
    expect(canDecide({ band: "critical", method: "explicit_human" }).allow).toBe(true);
  });
  it("denies every non-registered method", () => {
    for (const m of ["bounded_agent"] as const) {
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

const baseGrant = {
  approvalTypes: [] as string[],
  maxBand: "medium" as const,
  maxSpendCents: 50_000 as number | null,
  validFrom: new Date("2026-01-01T00:00:00Z"),
  validUntil: new Date("2026-12-31T00:00:00Z"),
  revokedAt: null as Date | null,
  delegateUserId: "bob",
};
const now = new Date("2026-07-15T00:00:00Z");
const baseInput = { approvalType: "budget", band: "low" as const, impliedSpendCents: 100, grant: baseGrant, actorUserId: "bob", now };

describe("delegated_human / coverage_escalation registration", () => {
  it("registers delegated_human", () => {
    expect(canDecide({ band: "low", method: "delegated_human" }).allow).toBe(true);
  });
  it("registers coverage_escalation", () => {
    expect(canDecide({ band: "low", method: "coverage_escalation" }).allow).toBe(true);
  });
});

describe("canDecideUnderDelegation", () => {
  it("allows a delegate acting within scope/band/limit/window", () => {
    expect(canDecideUnderDelegation(baseInput)).toEqual({ allow: true });
  });
  it("denies when actor is not the delegate", () => {
    expect(canDecideUnderDelegation({ ...baseInput, actorUserId: "carol" }).allow).toBe(false);
  });
  it("denies a revoked grant", () => {
    expect(canDecideUnderDelegation({ ...baseInput, grant: { ...baseGrant, revokedAt: now } }).allow).toBe(false);
  });
  it("denies before the window opens", () => {
    expect(canDecideUnderDelegation({ ...baseInput, now: new Date("2025-12-31T00:00:00Z") }).allow).toBe(false);
  });
  it("denies after the window closes", () => {
    expect(canDecideUnderDelegation({ ...baseInput, now: new Date("2027-01-01T00:00:00Z") }).allow).toBe(false);
  });
  it("denies an approval type outside a non-empty scope", () => {
    const grant = { ...baseGrant, approvalTypes: ["expense"] };
    expect(canDecideUnderDelegation({ ...baseInput, grant }).allow).toBe(false);
  });
  it("allows any type when scope is empty", () => {
    expect(canDecideUnderDelegation({ ...baseInput, approvalType: "anything" }).allow).toBe(true);
  });
  it("denies a band above the ceiling", () => {
    expect(canDecideUnderDelegation({ ...baseInput, band: "high" }).allow).toBe(false);
  });
  it("allows a band at the ceiling", () => {
    expect(canDecideUnderDelegation({ ...baseInput, band: "medium" }).allow).toBe(true);
  });
  it("denies spend over the limit", () => {
    expect(canDecideUnderDelegation({ ...baseInput, impliedSpendCents: 50_001 }).allow).toBe(false);
  });
  it("ignores spend when maxSpendCents is null", () => {
    const grant = { ...baseGrant, maxSpendCents: null };
    expect(canDecideUnderDelegation({ ...baseInput, impliedSpendCents: 999_999, grant }).allow).toBe(true);
  });
});
