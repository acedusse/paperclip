/**
 * FILE: packages/shared/src/types/issue-tree-control.ts
 * ABOUT: issue-tree-control.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - issue-tree-control.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: issue-tree-control.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/issue-tree-control.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type {
  IssueStatus,
  IssueTreeControlMode,
  IssueTreeHoldReleasePolicyStrategy,
  IssueTreeHoldStatus,
} from "../constants.js";

export interface IssueTreeHoldReleasePolicy {
  strategy: IssueTreeHoldReleasePolicyStrategy;
  note?: string | null;
}

export interface IssueTreePreviewRun {
  id: string;
  issueId: string;
  agentId: string;
  status: "queued" | "running";
  startedAt: Date | null;
  createdAt: Date;
}

export interface IssueTreePreviewAgent {
  agentId: string;
  issueCount: number;
  activeRunCount: number;
}

export interface IssueTreePreviewIssue {
  id: string;
  identifier: string | null;
  title: string;
  status: IssueStatus;
  parentId: string | null;
  depth: number;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  activeRun: IssueTreePreviewRun | null;
  activeHoldIds: string[];
  action: IssueTreeControlMode;
  skipped: boolean;
  skipReason: string | null;
}

export interface IssueTreePreviewWarning {
  code: string;
  message: string;
  issueIds?: string[];
}

export interface IssueTreePreviewTotals {
  totalIssues: number;
  affectedIssues: number;
  skippedIssues: number;
  activeRuns: number;
  queuedRuns: number;
  affectedAgents: number;
}

export interface IssueTreeControlPreview {
  companyId: string;
  rootIssueId: string;
  mode: IssueTreeControlMode;
  generatedAt: Date;
  releasePolicy: IssueTreeHoldReleasePolicy | null;
  totals: IssueTreePreviewTotals;
  countsByStatus: Partial<Record<IssueStatus, number>>;
  issues: IssueTreePreviewIssue[];
  skippedIssues: IssueTreePreviewIssue[];
  activeRuns: IssueTreePreviewRun[];
  affectedAgents: IssueTreePreviewAgent[];
  warnings: IssueTreePreviewWarning[];
}

export interface IssueTreeHoldMember {
  id: string;
  companyId: string;
  holdId: string;
  issueId: string;
  parentIssueId: string | null;
  depth: number;
  issueIdentifier: string | null;
  issueTitle: string;
  issueStatus: IssueStatus;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  activeRunId: string | null;
  activeRunStatus: string | null;
  skipped: boolean;
  skipReason: string | null;
  createdAt: Date;
}

export interface IssueTreeHold {
  id: string;
  companyId: string;
  rootIssueId: string;
  mode: IssueTreeControlMode;
  status: IssueTreeHoldStatus;
  reason: string | null;
  releasePolicy: IssueTreeHoldReleasePolicy | null;
  createdByActorType: "user" | "agent" | "system";
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdByRunId: string | null;
  releasedAt: Date | null;
  releasedByActorType: "user" | "agent" | "system" | null;
  releasedByAgentId: string | null;
  releasedByUserId: string | null;
  releasedByRunId: string | null;
  releaseReason: string | null;
  releaseMetadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  members?: IssueTreeHoldMember[];
}
// [END: module]
