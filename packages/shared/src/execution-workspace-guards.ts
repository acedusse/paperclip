/**
 * FILE: packages/shared/src/execution-workspace-guards.ts
 * ABOUT: execution-workspace-guards.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - execution-workspace-guards.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: execution-workspace-guards.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/execution-workspace-guards.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { ExecutionWorkspace } from "./types/workspace-runtime.js";

type ExecutionWorkspaceGuardTarget = Pick<ExecutionWorkspace, "closedAt" | "mode" | "name" | "status">;

const CLOSED_EXECUTION_WORKSPACE_STATUSES = new Set<ExecutionWorkspace["status"]>(["archived", "cleanup_failed"]);

export function isClosedIsolatedExecutionWorkspace(
  workspace: Pick<ExecutionWorkspaceGuardTarget, "closedAt" | "mode" | "status"> | null | undefined,
): boolean {
  if (!workspace) return false;
  if (workspace.mode !== "isolated_workspace") return false;
  return workspace.closedAt != null || CLOSED_EXECUTION_WORKSPACE_STATUSES.has(workspace.status);
}

export function getClosedIsolatedExecutionWorkspaceMessage(
  workspace: Pick<ExecutionWorkspaceGuardTarget, "name">,
): string {
  return `This issue is linked to the closed workspace "${workspace.name}". Move it to an open workspace before adding comments or resuming work.`;
}
// [END: module]
