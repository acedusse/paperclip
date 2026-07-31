/**
 * FILE: ui/src/api/stakeholder-shares.ts
 * ABOUT: stakeholder-shares.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - stakeholder-shares.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: Client for Combo-05 Phase 4c stakeholder transparency shares.
// PSEUDOCODE: 1. Board CRUD. 2. Public read by token.
// JSON_FLOW: {"file": "ui/src/api/stakeholder-shares.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { api } from "./client";

export type StakeholderShare = {
  id: string;
  companyId: string;
  label: string;
  status: string;
  /** Last 6 characters only — the full token is never returned by list. */
  tokenTail: string;
  showGoalProgress: boolean;
  showShippedWork: boolean;
  showNarrative: boolean;
  showActivityTimeline: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  rotatedAt: string | null;
  createdAt: string;
};

/** Create and rotate additionally return the full token, once. */
export type StakeholderShareWithToken = StakeholderShare & { token: string };

export type StakeholderGoalProgress = {
  byStatus: Record<string, number>;
  goals: Array<{ title: string; status: string }>;
};

export type StakeholderPayload = {
  companyName: string;
  goalProgress?: StakeholderGoalProgress;
  shippedWork?: Array<{ title: string; completedAt: string }>;
  narrative?: { headline: string; sections: string[]; text: string };
  activityTimeline?: Array<{ at: string; label: string }>;
};

export type StakeholderShareInput = {
  label: string;
  expiresAt?: string | null;
  showGoalProgress?: boolean;
  showShippedWork?: boolean;
  showNarrative?: boolean;
  showActivityTimeline?: boolean;
};

export const stakeholderSharesApi = {
  list: (companyId: string) => api.get<StakeholderShare[]>(`/companies/${companyId}/stakeholder-shares`),
  create: (companyId: string, input: StakeholderShareInput) =>
    api.post<StakeholderShareWithToken>(`/companies/${companyId}/stakeholder-shares`, input),
  update: (id: string, patch: Partial<StakeholderShareInput>) =>
    api.patch<StakeholderShare>(`/stakeholder-shares/${id}`, patch),
  revoke: (id: string) => api.post<StakeholderShare>(`/stakeholder-shares/${id}/revoke`, {}),
  rotate: (id: string) => api.post<StakeholderShareWithToken>(`/stakeholder-shares/${id}/rotate`, {}),
  /** Public, unauthenticated. */
  publicView: (token: string) => api.get<StakeholderPayload>(`/stakeholder/${token}`),
};
// [END: module]
