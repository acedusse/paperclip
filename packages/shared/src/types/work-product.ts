/**
 * FILE: packages/shared/src/types/work-product.ts
 * ABOUT: work-product.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - work-product.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: work-product.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/work-product.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export type IssueWorkProductType =
  | "preview_url"
  | "runtime_service"
  | "pull_request"
  | "branch"
  | "commit"
  | "artifact"
  | "document";

export type IssueWorkProductProvider =
  | "paperclip"
  | "github"
  | "vercel"
  | "s3"
  | "custom";

export type IssueWorkProductStatus =
  | "active"
  | "ready_for_review"
  | "approved"
  | "changes_requested"
  | "merged"
  | "closed"
  | "failed"
  | "archived"
  | "draft";

export type IssueWorkProductReviewState =
  | "none"
  | "needs_board_review"
  | "approved"
  | "changes_requested";

export interface IssueWorkProduct {
  id: string;
  companyId: string;
  projectId: string | null;
  issueId: string;
  executionWorkspaceId: string | null;
  runtimeServiceId: string | null;
  type: IssueWorkProductType;
  provider: IssueWorkProductProvider | string;
  externalId: string | null;
  title: string;
  url: string | null;
  status: IssueWorkProductStatus | string;
  reviewState: IssueWorkProductReviewState;
  isPrimary: boolean;
  healthStatus: "unknown" | "healthy" | "unhealthy";
  summary: string | null;
  metadata: Record<string, unknown> | null;
  sourceTrust?: import("../trust-policy.js").SourceTrustMetadata | null;
  createdByRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttachmentArtifactWorkProductMetadata {
  attachmentId: string;
  contentType: string;
  byteSize: number;
  contentPath: string;
  openPath: string;
  downloadPath: string;
  originalFilename?: string | null;
}
// [END: module]
