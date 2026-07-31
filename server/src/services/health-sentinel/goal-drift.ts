/**
 * FILE: server/src/services/health-sentinel/goal-drift.ts
 * ABOUT: Idea 026 — deterministic goal-alignment checks (orphan walk).
 *
 * SECTIONS:
 *   [TAG: module] - goal-drift.ts (health-sentinel module).
 */
// ==========================================
// [META: module]
// INTENT: Find open work decoupled from a live goal, and live goals with no work.
// PSEUDOCODE: 1. Walk parent chains to a goal. 2. Report orphans. 3. Report empty goals.
// JSON_FLOW: {"file": "server/src/services/health-sentinel/goal-drift.ts", "imports": "shared types", "exports": "findOrphanIssues, detectGoalDrift"}
// ==========================================
// [START: module]
import type { HealthFinding } from "@paperclipai/shared";

export interface DriftIssue {
  id: string;
  identifier: string | null;
  status: string;
  parentId: string | null;
  goalId: string | null;
}

export interface DriftGoal {
  id: string;
  title: string;
  status: string;
  level: string;
}

const TERMINAL_ISSUE_STATUSES = new Set(["done", "cancelled"]);
const LIVE_GOAL_STATUSES = new Set(["planned", "active"]);

/** Guards against a corrupted parent chain; matches MAX_PARENT_WALK_DEPTH elsewhere. */
const MAX_PARENT_WALK_DEPTH = 25;

/**
 * Resolve the goal an issue serves by walking up its parent chain. Sub-issues
 * routinely carry no `goalId` of their own and inherit it from an ancestor, so
 * a check that only looked at `goalId` would call most of a healthy tree
 * orphaned.
 *
 * Returns null when no ancestor carries a goal, or when the chain is broken
 * or cyclic.
 */
export function resolveIssueGoalId(issue: DriftIssue, byId: Map<string, DriftIssue>): string | null {
  let current: DriftIssue | undefined = issue;
  const seen = new Set<string>();
  for (let depth = 0; depth < MAX_PARENT_WALK_DEPTH && current; depth += 1) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    if (current.goalId) return current.goalId;
    if (!current.parentId) return null;
    current = byId.get(current.parentId);
  }
  return null;
}

/**
 * Open work that reaches no live goal — either no goal at all, or one that is
 * achieved/cancelled. This is the "whole sub-tree working hard on work that
 * decoupled from a live goal" case: expensive precisely because every
 * individual run looks healthy.
 */
export function findOrphanIssues(
  issues: DriftIssue[],
  goals: DriftGoal[],
): Array<{ issueId: string; reason: "no_goal" | "dead_goal"; goalId: string | null }> {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const results: Array<{ issueId: string; reason: "no_goal" | "dead_goal"; goalId: string | null }> = [];

  for (const issue of issues) {
    if (TERMINAL_ISSUE_STATUSES.has(issue.status)) continue;
    const goalId = resolveIssueGoalId(issue, byId);
    if (!goalId) {
      results.push({ issueId: issue.id, reason: "no_goal", goalId: null });
      continue;
    }
    const goal = goalById.get(goalId);
    if (!goal || !LIVE_GOAL_STATUSES.has(goal.status)) {
      results.push({ issueId: issue.id, reason: "dead_goal", goalId });
    }
  }

  return results;
}

export function detectGoalDrift(issues: DriftIssue[], goals: DriftGoal[]): HealthFinding[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const findings: HealthFinding[] = [];

  for (const orphan of findOrphanIssues(issues, goals)) {
    const issue = byId.get(orphan.issueId);
    const label = issue?.identifier ?? orphan.issueId;
    if (orphan.reason === "no_goal") {
      findings.push({
        kind: "orphan_issue",
        level: "warn",
        summary: `${label} is open but its parent chain reaches no goal.`,
        remediation: `Re-parent ${label} under a goal-linked issue, or set its goal directly — otherwise the spend on it is untracked against any objective.`,
        issueIds: [orphan.issueId],
        agentIds: [],
        goalIds: [],
      });
      continue;
    }
    const goal = orphan.goalId ? goalById.get(orphan.goalId) : undefined;
    findings.push({
      kind: "orphan_issue",
      level: "warn",
      summary: `${label} is open but serves "${goal?.title ?? orphan.goalId}", which is ${goal?.status ?? "missing"}.`,
      remediation: `Close ${label}, or re-point it at a live goal — work is continuing against an objective that is no longer live.`,
      issueIds: [orphan.issueId],
      agentIds: [],
      goalIds: orphan.goalId ? [orphan.goalId] : [],
    });
  }

  // A live goal with no open work is the inverse failure: nothing is drifting,
  // but nothing is advancing either.
  const goalsWithOpenWork = new Set<string>();
  for (const issue of issues) {
    if (TERMINAL_ISSUE_STATUSES.has(issue.status)) continue;
    const goalId = resolveIssueGoalId(issue, byId);
    if (goalId) goalsWithOpenWork.add(goalId);
  }

  for (const goal of goals) {
    if (!LIVE_GOAL_STATUSES.has(goal.status)) continue;
    // Agent- and task-level goals are internal decomposition; an empty one is
    // normal and reporting it would bury the company/team-level signal.
    if (goal.level !== "company" && goal.level !== "team") continue;
    if (goalsWithOpenWork.has(goal.id)) continue;
    findings.push({
      kind: "goal_without_work",
      level: "warn",
      summary: `Goal "${goal.title}" is ${goal.status} but has no open issues under it.`,
      remediation: `Decompose "${goal.title}" into issues, or mark it achieved/cancelled if it is no longer being pursued.`,
      issueIds: [],
      agentIds: [],
      goalIds: [goal.id],
    });
  }

  return findings;
}
// [END: module]
