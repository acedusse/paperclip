import { describe, it, expect } from "vitest";
import { createAutoApprovePolicySchema } from "./auto-approve-policy.js";

describe("createAutoApprovePolicySchema", () => {
  const base = {
    agentId: "11111111-1111-1111-1111-111111111111",
    approvalType: "work_product",
    maxBand: "low",
    maxSpendCents: 0,
    requireNoSecrets: true,
  };
  it("accepts a valid low-band policy", () => {
    expect(createAutoApprovePolicySchema.parse(base).maxBand).toBe("low");
  });
  it("rejects a band above the locked max", () => {
    expect(() => createAutoApprovePolicySchema.parse({ ...base, maxBand: "medium" })).toThrow();
  });
  it("rejects negative spend", () => {
    expect(() => createAutoApprovePolicySchema.parse({ ...base, maxSpendCents: -1 })).toThrow();
  });
  it("rejects a non-uuid agentId", () => {
    expect(() => createAutoApprovePolicySchema.parse({ ...base, agentId: "nope" })).toThrow();
  });
});
