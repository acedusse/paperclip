/**
 * FILE: ui/src/api/sidebarPreferences.ts
 * ABOUT: sidebarPreferences.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - sidebarPreferences.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: sidebarPreferences.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/sidebarPreferences.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { SidebarOrderPreference, UpsertSidebarOrderPreference } from "@paperclipai/shared";
import { api } from "./client";

export const sidebarPreferencesApi = {
  getCompanyOrder: () => api.get<SidebarOrderPreference>("/sidebar-preferences/me"),
  updateCompanyOrder: (data: UpsertSidebarOrderPreference) =>
    api.put<SidebarOrderPreference>("/sidebar-preferences/me", data),
  getProjectOrder: (companyId: string) =>
    api.get<SidebarOrderPreference>(`/companies/${companyId}/sidebar-preferences/me`),
  updateProjectOrder: (companyId: string, data: UpsertSidebarOrderPreference) =>
    api.put<SidebarOrderPreference>(`/companies/${companyId}/sidebar-preferences/me`, data),
};
// [END: module]
