/**
 * FILE: server/src/__tests__/invite-expiry.test.ts
 * ABOUT: invite-expiry.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - invite-expiry.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: invite-expiry.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/invite-expiry.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { companyInviteExpiresAt } from "../routes/access.js";

describe("companyInviteExpiresAt", () => {
  it("sets invite expiration to 72 hours after invite creation time", () => {
    const createdAtMs = Date.parse("2026-03-06T00:00:00.000Z");
    const expiresAt = companyInviteExpiresAt(createdAtMs);
    expect(expiresAt.toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });
});
// [END: module]
