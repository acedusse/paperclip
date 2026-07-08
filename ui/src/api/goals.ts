/**
 * FILE: ui/src/api/goals.ts
 * ABOUT: goals.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - goals.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: goals.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/goals.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { Goal } from "@paperclipai/shared";
import { api } from "./client";

export const goalsApi = {
  list: (companyId: string) => api.get<Goal[]>(`/companies/${companyId}/goals`),
  get: (id: string) => api.get<Goal>(`/goals/${id}`),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Goal>(`/companies/${companyId}/goals`, data),
  update: (id: string, data: Record<string, unknown>) => api.patch<Goal>(`/goals/${id}`, data),
  remove: (id: string) => api.delete<Goal>(`/goals/${id}`),
};
// [END: module]
