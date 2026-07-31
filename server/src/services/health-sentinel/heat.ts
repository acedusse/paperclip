/**
 * FILE: server/src/services/health-sentinel/heat.ts
 * ABOUT: Idea 006 — roll findings up into per-agent org-chart heat.
 *
 * SECTIONS:
 *   [TAG: module] - heat.ts (health-sentinel module).
 */
// ==========================================
// [META: module]
// INTENT: Attribute issue-level findings to the agents who own the work.
// PSEUDOCODE: 1. Map issues to assignees. 2. Score findings per agent. 3. Emit heat.
// JSON_FLOW: {"file": "server/src/services/health-sentinel/heat.ts", "imports": "shared types", "exports": "rollUpAgentHeat"}
// ==========================================
// [START: module]
import type { AgentHeat, HealthFinding, HealthFindingKind } from "@paperclipai/shared";

/**
 * Which pressure a finding represents. "Hot" nodes are jammed; "cold" nodes
 * are busy on work that has drifted from a live goal. They are scored into
 * separate channels because the fixes are opposite — unblock vs re-aim — and
 * summing them would make a jammed agent and an adrift agent look identical.
 */
const DRIFT_KINDS = new Set<HealthFindingKind>(["orphan_issue", "goal_without_work"]);

const LEVEL_WEIGHT = { info: 0, warn: 1, error: 2 } as const;

export function rollUpAgentHeat(
  findings: HealthFinding[],
  assigneeByIssueId: Map<string, string | null>,
): AgentHeat[] {
  const byAgent = new Map<string, AgentHeat>();

  const ensure = (agentId: string): AgentHeat => {
    const existing = byAgent.get(agentId);
    if (existing) return existing;
    const created: AgentHeat = { agentId, blockedScore: 0, driftScore: 0, reasons: [] };
    byAgent.set(agentId, created);
    return created;
  };

  for (const finding of findings) {
    const weight = LEVEL_WEIGHT[finding.level];
    if (weight === 0) continue;

    // Agents named directly by the finding (044), plus the assignees of every
    // issue it implicates. A finding with neither contributes no heat — it is
    // real, but there is no node to paint it on.
    const agentIds = new Set<string>(finding.agentIds);
    for (const issueId of finding.issueIds) {
      const assignee = assigneeByIssueId.get(issueId);
      if (assignee) agentIds.add(assignee);
    }

    for (const agentId of agentIds) {
      const heat = ensure(agentId);
      if (DRIFT_KINDS.has(finding.kind)) heat.driftScore += weight;
      else heat.blockedScore += weight;
      if (!heat.reasons.includes(finding.kind)) heat.reasons.push(finding.kind);
    }
  }

  return [...byAgent.values()].sort(
    (a, b) => b.blockedScore + b.driftScore - (a.blockedScore + a.driftScore),
  );
}
// [END: module]
