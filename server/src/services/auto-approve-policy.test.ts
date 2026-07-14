import { describe, it, expect } from "vitest";
import { evaluateAutoApprove, type AutoApprovePolicy, type AutoApproveContext } from "./auto-approve-policy.js";

const policy: AutoApprovePolicy = {
  id: "p1", agentId: "agent-1", approvalType: "work_product",
  maxBand: "low", maxSpendCents: 100, requireNoSecrets: true,
};
const baseCtx: AutoApproveContext = {
  approval: { type: "work_product", requestedByAgentId: "agent-1", payload: {} },
  risk: { band: "low", reasons: [] },
  impliedSpendCents: 0,
  hasSecretsOrSensitive: false,
};

describe("evaluateAutoApprove", () => {
  it("matches when every condition holds", () => {
    expect(evaluateAutoApprove(baseCtx, [policy]).matched?.id).toBe("p1");
  });
  it("never matches when risk snapshot is absent", () => {
    expect(evaluateAutoApprove({ ...baseCtx, risk: null }, [policy]).matched).toBeNull();
  });
  it("never matches above the policy band", () => {
    expect(evaluateAutoApprove({ ...baseCtx, risk: { band: "medium", reasons: [] } }, [policy]).matched).toBeNull();
  });
  it("does not match a different agent", () => {
    expect(
      evaluateAutoApprove({ ...baseCtx, approval: { ...baseCtx.approval, requestedByAgentId: "agent-2" } }, [policy]).matched,
    ).toBeNull();
  });
  it("does not match a different type", () => {
    expect(
      evaluateAutoApprove({ ...baseCtx, approval: { ...baseCtx.approval, type: "hire_agent" } }, [policy]).matched,
    ).toBeNull();
  });
  it("does not match over the spend cap", () => {
    expect(evaluateAutoApprove({ ...baseCtx, impliedSpendCents: 500 }, [policy]).matched).toBeNull();
  });
  it("does not match when secrets present and requireNoSecrets", () => {
    expect(evaluateAutoApprove({ ...baseCtx, hasSecretsOrSensitive: true }, [policy]).matched).toBeNull();
  });
  it("returns the first matching policy deterministically", () => {
    const p2: AutoApprovePolicy = { ...policy, id: "p2" };
    expect(evaluateAutoApprove(baseCtx, [policy, p2]).matched?.id).toBe("p1");
  });
});
