/**
 * FILE: ui/src/api/healthSentinel.ts
 * ABOUT: Combo-03 Health Sentinel API client.
 *
 * SECTIONS:
 *   [TAG: module] - healthSentinel.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: Fetch the company health report.
// PSEUDOCODE: 1. Call the health-sentinel endpoint.
// JSON_FLOW: {"file": "ui/src/api/healthSentinel.ts", "imports": "./client", "exports": "healthSentinelApi"}
// ==========================================
// [START: module]
import type { HealthReport } from "@paperclipai/shared";
import { api } from "./client";

export const healthSentinelApi = {
  report: (companyId: string) => api.get<HealthReport>(`/companies/${companyId}/health-sentinel`),
};
// [END: module]
