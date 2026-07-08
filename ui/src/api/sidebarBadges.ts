/**
 * FILE: ui/src/api/sidebarBadges.ts
 * ABOUT: sidebarBadges.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - sidebarBadges.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: sidebarBadges.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/sidebarBadges.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { SidebarBadges } from "@paperclipai/shared";
import { api } from "./client";

export const sidebarBadgesApi = {
  get: (companyId: string) => api.get<SidebarBadges>(`/companies/${companyId}/sidebar-badges`),
};
// [END: module]
