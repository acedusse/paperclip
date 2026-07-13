/**
 * FILE: packages/shared/src/validators/approval.test.ts
 * ABOUT: approval.test.ts (validators module).
 *
 * SECTIONS:
 *   [TAG: module] - approval.test.ts (validators module).
 */
// ==========================================
// [META: module]
// INTENT: approval.test.ts (validators module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/validators/approval.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  addApprovalCommentSchema,
  bulkResolveApprovalsSchema,
  requestApprovalRevisionSchema,
  resolveApprovalSchema,
} from "./approval.js";

describe("approval validators", () => {
  it("passes real line breaks through unchanged", () => {
    expect(addApprovalCommentSchema.parse({ body: "Looks good\n\nApproved." }).body)
      .toBe("Looks good\n\nApproved.");
    expect(resolveApprovalSchema.parse({ decisionNote: "Decision\n\nApproved." }).decisionNote)
      .toBe("Decision\n\nApproved.");
  });

  it("accepts null and omitted optional decision notes", () => {
    expect(resolveApprovalSchema.parse({ decisionNote: null }).decisionNote).toBeNull();
    expect(resolveApprovalSchema.parse({}).decisionNote).toBeUndefined();
    expect(requestApprovalRevisionSchema.parse({ decisionNote: null }).decisionNote).toBeNull();
    expect(requestApprovalRevisionSchema.parse({}).decisionNote).toBeUndefined();
  });

  it("normalizes escaped line breaks in approval comments and decision notes", () => {
    expect(addApprovalCommentSchema.parse({ body: "Looks good\\n\\nApproved." }).body)
      .toBe("Looks good\n\nApproved.");
    expect(resolveApprovalSchema.parse({ decisionNote: "Decision\\n\\nApproved." }).decisionNote)
      .toBe("Decision\n\nApproved.");
    expect(requestApprovalRevisionSchema.parse({ decisionNote: "Decision\\r\\nRevise." }).decisionNote)
      .toBe("Decision\nRevise.");
  });

  it("parses a valid bulk-resolve payload and rejects an empty ids array", () => {
    const parsed = bulkResolveApprovalsSchema.parse({
      ids: ["11111111-1111-1111-1111-111111111111"],
      action: "approve",
      decisionNote: "batch approved",
    });
    expect(parsed).toEqual({
      ids: ["11111111-1111-1111-1111-111111111111"],
      action: "approve",
      decisionNote: "batch approved",
    });

    expect(() => bulkResolveApprovalsSchema.parse({ ids: [], action: "approve" })).toThrow();
  });
});
// [END: module]
