import { describe, it, expect } from "vitest";
import { canDecide, canDecideUnderDelegation, canDecideAsBoundedAgent, METHOD_PRECEDENCE } from "./approval-authority.js";

describe("canDecide", () => {
  it("locks the precedence order", () => {
    expect(METHOD_PRECEDENCE).toEqual(["explicit_human", "delegated_human", "coverage_escalation", "bounded_agent", "auto_policy"]);
  });
  it("allows explicit_human at any band", () => {
    expect(canDecide({ band: "critical", method: "explicit_human" }).allow).toBe(true);
  });
  it("every precedence method is registered", () => {
    for (const method of METHOD_PRECEDENCE) {
      expect(canDecide({ band: "low", method }).allow).toBe(true);
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

  // Deny-message assertions: lock the exact wording, not just allow === false.
  it("deny message: actor is not the delegate", () => {
    const result = canDecideUnderDelegation({ ...baseInput, actorUserId: "carol" });
    expect(result.allow).toBe(false);
    expect(result.deny).toBe("actor is not this grant's delegate");
  });
  it("deny message: band above the ceiling", () => {
    const result = canDecideUnderDelegation({ ...baseInput, band: "high" });
    expect(result.allow).toBe(false);
    expect(result.deny).toBe(`delegation may not decide items above band ${baseGrant.maxBand}`);
  });
  it("deny message: spend over the limit", () => {
    const result = canDecideUnderDelegation({ ...baseInput, impliedSpendCents: 50_001 });
    expect(result.allow).toBe(false);
    expect(result.deny).toBe(
      `implied spend 50001 exceeds delegation limit ${baseGrant.maxSpendCents}`,
    );
  });

  // Exact-boundary cases: lock the current comparison operators (spend uses `>`,
  // window bounds use strict `<` / `>`, so equality at either edge is still allowed).
  it("boundary: impliedSpendCents === maxSpendCents -> allow (spend comparison is strict >)", () => {
    expect(
      canDecideUnderDelegation({ ...baseInput, impliedSpendCents: baseGrant.maxSpendCents as number }).allow,
    ).toBe(true);
  });
  it("boundary: impliedSpendCents === maxSpendCents + 1 -> deny", () => {
    expect(
      canDecideUnderDelegation({
        ...baseInput,
        impliedSpendCents: (baseGrant.maxSpendCents as number) + 1,
      }).allow,
    ).toBe(false);
  });
  it("boundary: now === validUntil -> allow (comparison is strict >, so equal is still within window)", () => {
    expect(canDecideUnderDelegation({ ...baseInput, now: baseGrant.validUntil }).allow).toBe(true);
  });
  it("boundary: now === validFrom -> allow (comparison is strict <, so equal is still within window)", () => {
    expect(canDecideUnderDelegation({ ...baseInput, now: baseGrant.validFrom }).allow).toBe(true);
  });
});

describe("bounded_agent registration", () => {
  it("bounded_agent is enabled for in-band items", () => {
    expect(canDecide({ band: "low", method: "bounded_agent" }).allow).toBe(true);
  });
  it("bounded_agent still cannot decide above the auto ceiling", () => {
    const r = canDecide({ band: "high", method: "bounded_agent", autoDecisionMaxBand: "low" });
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("may not decide items above band");
  });
});

describe("canDecideAsBoundedAgent", () => {
  const base = {
    approvalType: "work_product",
    band: "low" as const,
    impliedSpendCents: 100,
    deciderAgentId: "mgr-agent",
    requestedByAgentId: "worker-agent",
    grant: {
      approvalTypes: ["work_product"],
      maxBand: "low" as const,
      maxSpendCents: 1000,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validUntil: new Date("2026-12-31T00:00:00Z"),
      revokedAt: null as Date | null,
      delegateAgentId: "mgr-agent",
    },
    now: new Date("2026-07-15T00:00:00Z"),
  };

  it("allows an in-scope, in-band, in-budget decision by the granted agent", () => {
    expect(canDecideAsBoundedAgent(base).allow).toBe(true);
  });
  it("denies when the acting agent is not the grant's delegate", () => {
    const r = canDecideAsBoundedAgent({ ...base, deciderAgentId: "other-agent" });
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("not this grant's delegate agent");
  });
  it("denies a non-agent actor", () => {
    expect(canDecideAsBoundedAgent({ ...base, deciderAgentId: null }).allow).toBe(false);
  });
  it("denies self-approval (decider is the requester)", () => {
    const r = canDecideAsBoundedAgent({ ...base, requestedByAgentId: "mgr-agent" });
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("own work");
  });
  it("denies a revoked grant", () => {
    const r = canDecideAsBoundedAgent({ ...base, grant: { ...base.grant, revokedAt: new Date("2026-07-01T00:00:00Z") } });
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("revoked");
  });
  it("denies before validFrom and after validUntil", () => {
    expect(canDecideAsBoundedAgent({ ...base, now: new Date("2025-12-01T00:00:00Z") }).allow).toBe(false);
    expect(canDecideAsBoundedAgent({ ...base, now: new Date("2027-01-01T00:00:00Z") }).allow).toBe(false);
  });
  it("denies an out-of-scope approval type", () => {
    const r = canDecideAsBoundedAgent({ ...base, approvalType: "budget_change" });
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("outside the delegation scope");
  });
  it("denies above the grant band", () => {
    const r = canDecideAsBoundedAgent({ ...base, band: "high" });
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("above band");
  });
  it("denies over the spend cap", () => {
    const r = canDecideAsBoundedAgent({ ...base, impliedSpendCents: 5000 });
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("exceeds delegation limit");
  });
});
