/**
 * FILE: packages/shared/src/types/health-sentinel.ts
 * ABOUT: Wire/domain types for the Combo-03 Health Sentinel detectors.
 *
 * SECTIONS:
 *   [TAG: module] - health-sentinel.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: One escalation contract shared by every Health Sentinel detector.
// PSEUDOCODE: 1. Define finding vocabulary. 2. Define finding shape. 3. Define report.
// JSON_FLOW: {"file": "packages/shared/src/types/health-sentinel.ts", "imports": "none", "exports": "HealthFinding, HealthReport"}
// ==========================================
// [START: module]

export type HealthFindingLevel = "info" | "warn" | "error";

export type HealthFindingKind =
  /** 010 — a cycle in the blocks graph: everyone is "correctly" waiting. */
  | "blocker_cycle"
  /** 010 — open work blocked behind an issue that can never complete. */
  | "blocked_dead_end"
  /** 026 — open work with no parent chain to a live goal. */
  | "orphan_issue"
  /** 026 — an active goal with no open work under it. */
  | "goal_without_work"
  /** 059 — a decomposition that produced fewer children than it promised. */
  | "decomposition_incomplete"
  /** 059 semantic tier — sibling sub-issues that duplicate each other. */
  | "decomposition_overlap"
  /** 044 — an agent whose failure rate has burned its error budget. */
  | "agent_error_budget_burned";

/**
 * Every finding names the *specific* thing to fix. A detector that can only
 * say "something is wrong here" is not actionable enough to escalate, so
 * `remediation` is required, not optional.
 */
export interface HealthFinding {
  kind: HealthFindingKind;
  level: HealthFindingLevel;
  /** Human-readable statement of what is wrong. */
  summary: string;
  /** The concrete action that resolves it — the edge to cut, the issue to re-parent. */
  remediation: string;
  issueIds: string[];
  agentIds: string[];
  goalIds: string[];
}

/**
 * Idea 006 — per-agent pressure for the org-chart bottleneck overlay.
 *
 * Two distinct pressures, deliberately kept separate rather than summed into
 * one number: an agent jammed behind blockers ("hot") and an agent working on
 * goal-decoupled work ("cold") are opposite problems with opposite fixes, and
 * a single score would render them identically.
 */
export interface AgentHeat {
  agentId: string;
  /** Blocked/deadlocked/unreliable pressure. Higher = more jammed. */
  blockedScore: number;
  /** Decoupled-from-goal pressure. Higher = more work adrift. */
  driftScore: number;
  /** Finding kinds contributing to this agent's heat, for tooltips. */
  reasons: HealthFindingKind[];
}

export interface HealthReport {
  companyId: string;
  generatedAt: string;
  status: "healthy" | "warn" | "unhealthy";
  findings: HealthFinding[];
  /** Per-agent rollup for the org-chart heatmap. Only agents with pressure appear. */
  heat: AgentHeat[];
}

/**
 * Per-agent rolling reliability. Introduced with 044, which is the consumer
 * that defines what "success" means — deliberately not shipped before it.
 */
export interface AgentRunSignals {
  agentId: string;
  runCount: number;
  succeededCount: number;
  failedCount: number;
  retriedRunCount: number;
}
// [END: module]
