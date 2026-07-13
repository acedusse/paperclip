/**
 * FILE: ui/src/api/approvals.ts
 * ABOUT: approvals.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - approvals.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: approvals.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/approvals.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { Approval, ApprovalComment, Issue } from "@paperclipai/shared";
import { api } from "./client";

export const approvalsApi = {
  list: (companyId: string, status?: string) =>
    api.get<Approval[]>(
      `/companies/${companyId}/approvals${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Approval>(`/companies/${companyId}/approvals`, data),
  get: (id: string) => api.get<Approval>(`/approvals/${id}`),
  approve: (id: string, decisionNote?: string) =>
    api.post<Approval>(`/approvals/${id}/approve`, { decisionNote }),
  reject: (id: string, decisionNote?: string) =>
    api.post<Approval>(`/approvals/${id}/reject`, { decisionNote }),
  requestRevision: (id: string, decisionNote?: string) =>
    api.post<Approval>(`/approvals/${id}/request-revision`, { decisionNote }),
  resubmit: (id: string, payload?: Record<string, unknown>) =>
    api.post<Approval>(`/approvals/${id}/resubmit`, { payload }),
  listComments: (id: string) => api.get<ApprovalComment[]>(`/approvals/${id}/comments`),
  addComment: (id: string, body: string) =>
    api.post<ApprovalComment>(`/approvals/${id}/comments`, { body }),
  listIssues: (id: string) => api.get<Issue[]>(`/approvals/${id}/issues`),
  triage: (companyId: string) =>
    api.get<{ items: any[]; groups: { key: string; type: string; agentId: string | null; ids: string[] }[] }>(
      `/companies/${companyId}/approvals/triage`,
    ),
  bulk: (companyId: string, body: { ids: string[]; action: "approve" | "reject" | "request_changes"; decisionNote?: string }) =>
    api.post<{ results: { id: string; ok: boolean; error?: string }[] }>(`/companies/${companyId}/approvals/bulk`, body),
};
// [END: module]
