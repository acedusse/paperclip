/**
 * FILE: ui/src/api/companyPreflight.ts
 * ABOUT: Combo-10 company preflight API client.
 *
 * SECTIONS:
 *   [TAG: module] - companyPreflight.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: Fetch the company launch-readiness report.
// PSEUDOCODE: 1. Call the preflight endpoint.
// JSON_FLOW: {"file": "ui/src/api/companyPreflight.ts", "imports": "./client", "exports": "companyPreflightApi"}
// ==========================================
// [START: module]
import type { PreflightReport } from "@paperclipai/shared";
import { api } from "./client";

export const companyPreflightApi = {
  report: (companyId: string) => api.get<PreflightReport>(`/companies/${companyId}/preflight`),
};
// [END: module]
