/**
 * FILE: ui/src/api/dashboard.ts
 * ABOUT: dashboard.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - dashboard.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: dashboard.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/dashboard.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { DashboardSummary } from "@paperclipai/shared";
import { api } from "./client";

export const dashboardApi = {
  summary: (companyId: string) => api.get<DashboardSummary>(`/companies/${companyId}/dashboard`),
};
// [END: module]
