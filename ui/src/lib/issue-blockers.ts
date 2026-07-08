/**
 * FILE: ui/src/lib/issue-blockers.ts
 * ABOUT: issue-blockers.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - issue-blockers.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: issue-blockers.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/issue-blockers.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { IssueRelationIssueSummary } from "@paperclipai/shared";

export function isAssignedBacklogBlocker(blocker: IssueRelationIssueSummary): boolean {
  return blocker.status === "backlog" && Boolean(blocker.assigneeAgentId);
}

export function hasAssignedBacklogBlocker(
  blockers: IssueRelationIssueSummary[] | undefined | null,
): boolean {
  if (!blockers || blockers.length === 0) return false;
  return blockers.some((blocker) => {
    if (isAssignedBacklogBlocker(blocker)) return true;
    if (blocker.terminalBlockers?.some(isAssignedBacklogBlocker)) return true;
    return false;
  });
}
// [END: module]
