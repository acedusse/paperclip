/**
 * FILE: ui/src/api/userProfiles.ts
 * ABOUT: userProfiles.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - userProfiles.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: userProfiles.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/userProfiles.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { UserProfileResponse } from "@paperclipai/shared";
import { api } from "./client";

export const userProfilesApi = {
  get: (companyId: string, userSlug: string) =>
    api.get<UserProfileResponse>(
      `/companies/${companyId}/users/${encodeURIComponent(userSlug)}/profile`,
    ),
};
// [END: module]
