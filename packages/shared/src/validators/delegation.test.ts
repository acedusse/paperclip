import { describe, it, expect } from "vitest";
import { createDelegationGrantSchema, coverageConfigSchema, outOfOfficeSchema } from "./delegation.js";
import { resolveApprovalSchema } from "./approval.js";

describe("createDelegationGrantSchema", () => {
  it("accepts a full grant", () => {
    const r = createDelegationGrantSchema.safeParse({
      delegateUserId: "bob", approvalTypes: [], maxBand: "medium",
      maxSpendCents: 50000, validUntil: "2026-12-31T00:00:00Z",
    });
    expect(r.success).toBe(true);
  });
  it("rejects an invalid band", () => {
    const r = createDelegationGrantSchema.safeParse({ delegateUserId: "bob", maxBand: "nope", validUntil: "2026-12-31T00:00:00Z" });
    expect(r.success).toBe(false);
  });
  it("defaults approvalTypes to empty and maxSpendCents to null", () => {
    const r = createDelegationGrantSchema.parse({ delegateUserId: "bob", maxBand: "low", validUntil: "2026-12-31T00:00:00Z" });
    expect(r.approvalTypes).toEqual([]);
    expect(r.maxSpendCents).toBeNull();
  });
});

describe("coverageConfigSchema", () => {
  it("rejects enabled without a backup", () => {
    expect(coverageConfigSchema.safeParse({ enabled: true }).success).toBe(false);
  });
  it("accepts enabled with a backup", () => {
    expect(coverageConfigSchema.safeParse({ enabled: true, backupUserId: "carol" }).success).toBe(true);
  });
  it("accepts disabled with no backup", () => {
    expect(coverageConfigSchema.safeParse({ enabled: false }).success).toBe(true);
  });
});

describe("outOfOfficeSchema", () => {
  it("requires backup + until when enabled", () => {
    expect(outOfOfficeSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(outOfOfficeSchema.safeParse({ enabled: true, backupUserId: "bob", maxBand: "medium", until: "2026-08-01T00:00:00Z" }).success).toBe(true);
  });
});

describe("resolveApprovalSchema actingUnderGrantId", () => {
  it("accepts an optional grant id", () => {
    expect(resolveApprovalSchema.safeParse({ actingUnderGrantId: "6f9619ff-8b86-d011-b42d-00cf4fc964ff" }).success).toBe(true);
  });
  it("rejects a non-uuid grant id", () => {
    expect(resolveApprovalSchema.safeParse({ actingUnderGrantId: "nope" }).success).toBe(false);
  });
});
