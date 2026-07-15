/**
 * FILE: server/src/services/approval-risk.test.ts
 * ABOUT: approval-risk.test.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - approval-risk.test.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: approval-risk.test.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/approval-risk.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, it, expect } from "vitest";
import { riskScore, bandRank, hasSensitiveBoundary, impliedSpendFromApproval } from "./approval-risk.js";

describe("riskScore", () => {
  it("is deterministic and low for a trivial trusted doc edit", () => {
    const ctx = {
      approval: { type: "work_product", payload: {} },
      agentTrustStage: "trusted" as const,
      impliedSpendCents: 10,
      changeset: { additions: 2, deletions: 0, filesChanged: 1 },
    };
    const a = riskScore(ctx);
    const b = riskScore(ctx);
    expect(a).toEqual(b);
    expect(a.band).toBe("low");
  });

  it("escalates for untrusted agent crossing a sensitive boundary with big spend", () => {
    const ctx = {
      approval: { type: "hire_agent", payload: { budgetMonthlyCents: 50000, secretRef: "x" } },
      agentTrustStage: "untrusted" as const,
      impliedSpendCents: 50000,
      changeset: null,
    };
    const r = riskScore(ctx);
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.band).toBe("critical");
    expect(r.reasons.join(" ")).toMatch(/sensitive|spend|trust/i);
  });
});

describe("risk helpers", () => {
  it("ranks bands low<medium<high<critical", () => {
    expect(bandRank("low")).toBe(0);
    expect(bandRank("critical")).toBe(3);
    expect(bandRank("high")).toBeGreaterThan(bandRank("medium"));
  });
  it("flags sensitive type or sensitive payload key", () => {
    expect(hasSensitiveBoundary({ type: "hire_agent", payload: {} })).toBe(true);
    expect(hasSensitiveBoundary({ type: "work_product", payload: { secretRef: "x" } })).toBe(true);
    expect(hasSensitiveBoundary({ type: "work_product", payload: {} })).toBe(false);
  });
  it("reads implied spend from budgetMonthlyCents, else 0", () => {
    expect(impliedSpendFromApproval({ budgetMonthlyCents: 500 })).toBe(500);
    expect(impliedSpendFromApproval({})).toBe(0);
  });
});
// [END: module]
