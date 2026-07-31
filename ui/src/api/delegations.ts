/**
 * FILE: ui/src/api/delegations.ts
 * ABOUT: delegations.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - delegations.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: delegations.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/delegations.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { api } from "./client";

export type DelegationBand = "low" | "medium" | "high" | "critical";

export type DelegationGrant = {
  id: string;
  companyId: string;
  grantorUserId: string;
  delegateUserId: string;
  approvalTypes: string[];
  maxBand: DelegationBand;
  maxSpendCents: number | null;
  validFrom: string;
  validUntil: string;
  revokedAt: string | null;
  source: string;
  createdAt: string;
};

export type CreateDelegationGrantBody = {
  delegateUserId: string;
  approvalTypes: string[];
  maxBand: DelegationBand;
  maxSpendCents: number | null;
  validFrom?: string;
  validUntil: string;
};

export type CoverageConfig = {
  companyId: string;
  enabled: boolean;
  backupUserId: string | null;
  slaCriticalMinutes: number;
  slaHighMinutes: number;
  slaMediumMinutes: number;
  slaLowMinutes: number;
  updatedAt: string;
};

export type CoverageConfigUpdate = {
  enabled: boolean;
  backupUserId?: string | null;
  slaCriticalMinutes?: number;
  slaHighMinutes?: number;
  slaMediumMinutes?: number;
  slaLowMinutes?: number;
};

export type OutOfOfficeUpdate = {
  enabled: boolean;
  backupUserId?: string;
  maxBand?: DelegationBand;
  until?: string;
};

export type OutOfOfficeResult = {
  grant: DelegationGrant | null;
  revokedIds: string[];
};

export type BoundedAgentApprover = {
  id: string;
  companyId: string;
  grantorUserId: string;
  delegateAgentId: string;
  approvalTypes: string[];
  maxBand: DelegationBand;
  maxSpendCents: number | null;
  validFrom: string;
  validUntil: string;
  revokedAt: string | null;
  createdAt: string;
};

export type CreateBoundedAgentApproverBody = {
  delegateAgentId: string;
  approvalTypes: string[];
  maxBand: DelegationBand;
  maxSpendCents: number | null;
  validUntil: string;
};

export const delegationsApi = {
  listGrants: (companyId: string) =>
    api.get<DelegationGrant[]>(`/companies/${companyId}/delegations`),
  createGrant: (companyId: string, body: CreateDelegationGrantBody) =>
    api.post<DelegationGrant>(`/companies/${companyId}/delegations`, body),
  revokeGrant: (id: string) => api.post<DelegationGrant>(`/delegations/${id}/revoke`, {}),
  getCoverageConfig: (companyId: string) =>
    api.get<CoverageConfig | null>(`/companies/${companyId}/coverage-config`),
  updateCoverageConfig: (companyId: string, body: CoverageConfigUpdate) =>
    api.put<CoverageConfig>(`/companies/${companyId}/coverage-config`, body),
  setOutOfOffice: (companyId: string, body: OutOfOfficeUpdate) =>
    api.post<OutOfOfficeResult>(`/companies/${companyId}/out-of-office`, body),
  listBoundedAgents: (companyId: string) =>
    api.get<BoundedAgentApprover[]>(`/companies/${companyId}/bounded-agent-approvers`),
  createBoundedAgent: (companyId: string, body: CreateBoundedAgentApproverBody) =>
    api.post<BoundedAgentApprover>(`/companies/${companyId}/bounded-agent-approvers`, body),
  revokeBoundedAgent: (id: string) =>
    api.post<BoundedAgentApprover>(`/bounded-agent-approvers/${id}/revoke`, {}),
};
// [END: module]
