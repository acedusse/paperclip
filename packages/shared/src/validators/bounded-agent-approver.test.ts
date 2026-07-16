import { describe, it, expect } from "vitest";
import { createBoundedAgentApproverSchema } from "./bounded-agent-approver.js";

describe("createBoundedAgentApproverSchema", () => {
  const good = {
    delegateAgentId: "mgr-agent",
    approvalTypes: [] as string[],
    maxBand: "low",
    maxSpendCents: 1000,
    validUntil: "2026-12-31T00:00:00.000Z",
  };
  it("accepts a low-band grant", () => {
    expect(createBoundedAgentApproverSchema.safeParse(good).success).toBe(true);
  });
  it("rejects a maxBand above the auto ceiling", () => {
    const r = createBoundedAgentApproverSchema.safeParse({ ...good, maxBand: "high" });
    expect(r.success).toBe(false);
  });
  it("requires a delegateAgentId", () => {
    const r = createBoundedAgentApproverSchema.safeParse({ ...good, delegateAgentId: "" });
    expect(r.success).toBe(false);
  });
});
