/**
 * FILE: ui/src/lib/issueActiveRun.ts
 * ABOUT: issueActiveRun.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - issueActiveRun.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: issueActiveRun.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/issueActiveRun.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { Issue } from "@paperclipai/shared";
import type { ActiveRunForIssue } from "../api/heartbeats";

export function shouldTrackIssueActiveRun(
  issue: Pick<Issue, "status" | "executionRunId"> | null | undefined,
): boolean {
  return Boolean(issue && (issue.status === "in_progress" || issue.executionRunId));
}

export function resolveIssueActiveRun(
  issue: Pick<Issue, "status" | "executionRunId"> | null | undefined,
  activeRun: ActiveRunForIssue | null | undefined,
): ActiveRunForIssue | null {
  return shouldTrackIssueActiveRun(issue) ? (activeRun ?? null) : null;
}
// [END: module]
