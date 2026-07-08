/**
 * FILE: server/src/__tests__/access-validators.test.ts
 * ABOUT: access-validators.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - access-validators.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: access-validators.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/access-validators.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  updateCompanyMemberWithPermissionsSchema,
  updateCurrentUserProfileSchema,
} from "@paperclipai/shared";

describe("access validators", () => {
  it("accepts HTTP(S) and Paperclip asset image URLs", () => {
    expect(updateCurrentUserProfileSchema.safeParse({
      name: "Ada Lovelace",
      image: "https://example.com/avatar.png",
    }).success).toBe(true);
    expect(updateCurrentUserProfileSchema.safeParse({
      name: "Ada Lovelace",
      image: "/api/assets/avatar/content",
    }).success).toBe(true);
  });

  it("rejects data URI profile images", () => {
    expect(updateCurrentUserProfileSchema.safeParse({
      name: "Ada Lovelace",
      image: "data:image/png;base64,AAAA",
    }).success).toBe(false);
  });

  it("defaults omitted combined member grants to an empty list", () => {
    const result = updateCompanyMemberWithPermissionsSchema.parse({
      membershipRole: "operator",
    });

    expect(result.grants).toEqual([]);
  });
});
// [END: module]
