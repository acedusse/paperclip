/**
 * FILE: packages/shared/src/types/workspace-operation.ts
 * ABOUT: workspace-operation.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - workspace-operation.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: workspace-operation.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/workspace-operation.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export type WorkspaceOperationPhase =
  | "worktree_prepare"
  | "workspace_provision"
  | "workspace_teardown"
  | "worktree_cleanup"
  | "workspace_finalize";

export type WorkspaceOperationStatus = "running" | "succeeded" | "failed" | "skipped";

export interface WorkspaceOperation {
  id: string;
  companyId: string;
  executionWorkspaceId: string | null;
  heartbeatRunId: string | null;
  phase: WorkspaceOperationPhase;
  command: string | null;
  cwd: string | null;
  status: WorkspaceOperationStatus;
  exitCode: number | null;
  logStore: string | null;
  logRef: string | null;
  logBytes: number | null;
  logSha256: string | null;
  logCompressed: boolean;
  stdoutExcerpt: string | null;
  stderrExcerpt: string | null;
  metadata: Record<string, unknown> | null;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
// [END: module]
