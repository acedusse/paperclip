/**
 * FILE: server/src/services/push-notifications.test.ts
 * ABOUT: push-notifications.test.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - buildApprovalPushBody pure builder tests.
 */
// ==========================================
// [META: module]
// INTENT: Verify buildApprovalPushBody deterministically maps approval input to a push payload shape.
// PSEUDOCODE: 1. Call twice with same input, expect deep equality. 2. Assert url/tag/band/body fields.
// JSON_FLOW: {"file": "server/src/services/push-notifications.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, it, expect } from "vitest";
import { buildApprovalPushBody } from "./push-notifications.js";

describe("buildApprovalPushBody", () => {
  it("builds a deterministic title/body/url/tag", () => {
    const a = buildApprovalPushBody({ approvalType: "hire_agent", band: "critical", companyId: "c1", approvalId: "ap1" });
    expect(a).toEqual(buildApprovalPushBody({ approvalType: "hire_agent", band: "critical", companyId: "c1", approvalId: "ap1" }));
    expect(a.url).toBe("/approvals/ap1");
    expect(a.approvalId).toBe("ap1");
    expect(a.tag).toBe("approval-ap1");
    expect(a.band).toBe("critical");
    expect(a.body).toContain("hire_agent");
  });
});
// [END: module]
