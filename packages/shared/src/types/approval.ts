/**
 * FILE: packages/shared/src/types/approval.ts
 * ABOUT: approval.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - approval.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: approval.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/approval.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { ApprovalStatus, ApprovalType } from "../constants.js";

export interface Approval {
  id: string;
  companyId: string;
  type: ApprovalType;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Combo-05 Phase 2a: deciding method from the latest decision-audit record (e.g. "auto_policy"); only populated on the single-approval read. */
  decidedVia?: string | null;
}

export interface ApprovalComment {
  id: string;
  companyId: string;
  approvalId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}
// [END: module]
