/**
 * FILE: server/src/services/health-sentinel/reliability.ts
 * ABOUT: Idea 044 — per-agent reliability SLOs and error budgets.
 *
 * SECTIONS:
 *   [TAG: module] - reliability.ts (health-sentinel module).
 */
// ==========================================
// [META: module]
// INTENT: Flag agents whose rolling failure rate has burned their error budget.
// PSEUDOCODE: 1. Require a minimum sample. 2. Compute failure rate. 3. Compare to budget.
// JSON_FLOW: {"file": "server/src/services/health-sentinel/reliability.ts", "imports": "shared types", "exports": "detectReliabilityBreaches, DEFAULT_RELIABILITY_SLO"}
// ==========================================
// [START: module]
import type { AgentRunSignals, HealthFinding } from "@paperclipai/shared";

export interface ReliabilitySlo {
  /** Tolerated fraction of terminal runs that may fail, 0..1. */
  errorBudget: number;
  /**
   * Minimum terminal runs before the rate is trusted. Without this, one
   * failure out of one run reads as 100% failure and pages the operator about
   * an agent that has barely started.
   */
  minimumSample: number;
}

export const DEFAULT_RELIABILITY_SLO: ReliabilitySlo = {
  errorBudget: 0.2,
  minimumSample: 10,
};

export interface ReliabilityAgent {
  id: string;
  name: string;
}

export function detectReliabilityBreaches(
  agents: ReliabilityAgent[],
  signalsByAgent: Map<string, AgentRunSignals>,
  slo: ReliabilitySlo = DEFAULT_RELIABILITY_SLO,
): HealthFinding[] {
  const findings: HealthFinding[] = [];

  for (const agent of agents) {
    const signals = signalsByAgent.get(agent.id);
    if (!signals) continue;

    // Only terminal runs carry a verdict; in-flight runs are not yet evidence.
    const terminal = signals.succeededCount + signals.failedCount;
    if (terminal < slo.minimumSample) continue;

    const failureRate = signals.failedCount / terminal;
    if (failureRate <= slo.errorBudget) continue;

    const pct = Math.round(failureRate * 100);
    const budgetPct = Math.round(slo.errorBudget * 100);
    findings.push({
      kind: "agent_error_budget_burned",
      level: "error",
      summary: `${agent.name} failed ${signals.failedCount} of ${terminal} runs (${pct}%), over its ${budgetPct}% error budget.`,
      remediation: `Constrain ${agent.name} — pause it, lower its concurrency, or review its adapter config and instructions. Every failed run still costs tokens and the recovery cycles compound.`,
      issueIds: [],
      agentIds: [agent.id],
      goalIds: [],
    });
  }

  return findings;
}
// [END: module]
