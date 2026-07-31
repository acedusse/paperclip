/**
 * FILE: server/src/services/health-sentinel/decomposition.ts
 * ABOUT: Idea 059 — structural decomposition-quality checks.
 *
 * SECTIONS:
 *   [TAG: module] - decomposition.ts (health-sentinel module).
 */
// ==========================================
// [META: module]
// INTENT: Catch plans that promised N children and produced fewer.
// PSEUDOCODE: 1. Compare requested vs created children. 2. Report shortfalls.
// JSON_FLOW: {"file": "server/src/services/health-sentinel/decomposition.ts", "imports": "shared types", "exports": "detectDecompositionGaps"}
// ==========================================
// [START: module]
import type { HealthFinding } from "@paperclipai/shared";

export interface DecompositionRecord {
  id: string;
  sourceIssueId: string;
  sourceIssueIdentifier: string | null;
  status: string;
  requestedChildCount: number;
  childIssueIds: string[];
}

/**
 * Structural tier only. "Did the plan produce what it said it would" is
 * decidable from the record itself; whether the children are *complete* or
 * *overlapping* is a semantic judgement and belongs to Phase 3's model tier.
 *
 * Only settled decompositions are checked — an in-flight one is expected to
 * have fewer children than requested while it is still creating them, so
 * flagging those would fire on every healthy decomposition in progress.
 */
export function detectDecompositionGaps(records: DecompositionRecord[]): HealthFinding[] {
  const findings: HealthFinding[] = [];

  for (const record of records) {
    if (record.status === "in_flight") continue;
    const created = record.childIssueIds.length;
    if (record.requestedChildCount <= 0) continue;
    if (created >= record.requestedChildCount) continue;

    const label = record.sourceIssueIdentifier ?? record.sourceIssueId;
    const missing = record.requestedChildCount - created;
    findings.push({
      kind: "decomposition_incomplete",
      level: created === 0 ? "error" : "warn",
      summary:
        created === 0
          ? `The accepted plan for ${label} promised ${record.requestedChildCount} sub-issues but created none.`
          : `The accepted plan for ${label} promised ${record.requestedChildCount} sub-issues but created ${created} — ${missing} missing.`,
      remediation:
        created === 0
          ? `Re-run decomposition for ${label}; the plan was accepted but never materialised, so nothing is scheduled against it.`
          : `Create the ${missing} missing sub-issue(s) under ${label}, or amend the plan to match what is actually needed.`,
      issueIds: [record.sourceIssueId],
      agentIds: [],
      goalIds: [],
    });
  }

  return findings;
}
// [END: module]
