/**
 * FILE: packages/shared/src/types/company.ts
 * ABOUT: company.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - company.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: company.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/company.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { CompanyStatus, PauseReason } from "../constants.js";

export interface Company {
  id: string;
  name: string;
  description: string | null;
  status: CompanyStatus;
  pauseReason: PauseReason | null;
  pausedAt: Date | null;
  issuePrefix: string;
  issueCounter: number;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  attachmentMaxBytes: number;
  maxConcurrentRuns?: number | null;
  maxRunWallClockMs?: number | null;
  maxRunCostCents?: number | null;
  maxRunTurns?: number | null;
  requireBoardApprovalForNewAgents: boolean;
  feedbackDataSharingEnabled: boolean;
  feedbackDataSharingConsentAt: Date | null;
  feedbackDataSharingConsentByUserId: string | null;
  feedbackDataSharingTermsVersion: string | null;
  brandColor: string | null;
  logoAssetId: string | null;
  logoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}
// [END: module]
