/**
 * FILE: packages/shared/src/types/run-signals.ts
 * ABOUT: Wire/domain types for the Combo-03 run-signal read model.
 *
 * SECTIONS:
 *   [TAG: module] - run-signals.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: Shared shapes for per-issue run signals consumed by Health Sentinel detectors.
// PSEUDOCODE: 1. Define scope. 2. Define signals. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/run-signals.ts", "imports": "none", "exports": "IssueRunSignalScope, IssueRunSignals"}
// ==========================================
// [START: module]

/**
 * Scope is an (issue, agent) pair, not an issue alone: the detectors ask
 * "what has *this agent* been doing on *this issue*". Widening to all agents
 * changes which issues trip a detector.
 */
export interface IssueRunSignalScope {
  issueId: string;
  agentId: string;
}

export interface IssueRunSignals {
  issueId: string;
  agentId: string;
  /** Newest-first, capped at MAX_RUNS_FOR_STREAK. */
  runIds: string[];
  terminalRunCount: number;
  activeRunCount: number;
  runCountLastHour: number;
  runCountLastSixHours: number;
  /** Comments by this agent, from runs attributed to this issue. */
  commentCount: number;
  commentCountLastHour: number;
  commentCountLastSixHours: number;
  /** Consecutive newest terminal runs that produced no issue comment. */
  noCommentStreak: number;
  /** Per-issue, NOT agent-scoped. */
  costCents: number;
}
// [END: module]
