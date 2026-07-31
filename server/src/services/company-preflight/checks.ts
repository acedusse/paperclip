/**
 * FILE: server/src/services/company-preflight/checks.ts
 * ABOUT: Combo-10 Phase 1 — pure launch-readiness checks (idea 004 static tier).
 *
 * SECTIONS:
 *   [TAG: module] - checks.ts (company-preflight module).
 */
// ==========================================
// [META: module]
// INTENT: Decide launch readiness from a loaded snapshot, with no I/O.
// PSEUDOCODE: 1. Define context. 2. One pure function per check. 3. Export registry.
// JSON_FLOW: {"file": "server/src/services/company-preflight/checks.ts", "imports": "shared types", "exports": "PREFLIGHT_CHECKS, PreflightContext"}
// ==========================================
// [START: module]
import { getAgentOrgChainHealth, type AgentEligibilityAgent } from "@paperclipai/shared";
import type { PreflightFinding } from "@paperclipai/shared";
import type { RunCostPercentiles } from "./projection.js";

export interface PreflightAgent extends AgentEligibilityAgent {
  name: string;
  adapterType: string;
  /** Open issues currently assigned to this agent. */
  openIssueCount: number;
}

export interface PreflightSecretBinding {
  label: string | null;
  configPath: string;
  targetType: string;
  targetId: string;
  required: boolean;
  /** False when the bound secret has no readable version. */
  hasReadableVersion: boolean;
}

export interface PreflightBudgetPolicy {
  scopeType: string;
  scopeId: string;
  amountCents: number;
  observedCents: number;
  isActive: boolean;
}

export interface PreflightContext {
  companyId: string;
  agents: PreflightAgent[];
  /** Adapter types the registry currently has active. */
  availableAdapterTypes: Set<string>;
  secretBindings: PreflightSecretBinding[];
  budgetPolicies: PreflightBudgetPolicy[];
  /** Median observed cost per run, or null when there is no history. */
  medianRunCostCents: number | null;
  costEventCount: number;
  /** Percentile spread for the Phase 4 projection; null with no history. */
  runCostPercentiles: RunCostPercentiles | null;
}

export interface PreflightCheck {
  name: string;
  run(ctx: PreflightContext): PreflightFinding[];
}

/**
 * Statuses that mean the agent can actually be invoked. Reuses the shared
 * eligibility vocabulary rather than a second local list, so preflight and the
 * scheduler cannot disagree about what "ready" means.
 */
function invokableAgents(ctx: PreflightContext): PreflightAgent[] {
  return ctx.agents.filter(
    (agent) => agent.status !== "terminated" && agent.status !== "pending_approval" && agent.status !== "paused",
  );
}

const noInvokableAgents: PreflightCheck = {
  name: "no_invokable_agents",
  run(ctx) {
    if (invokableAgents(ctx).length > 0) return [];
    return [
      {
        code: "no_invokable_agents",
        level: "error",
        message: "No agent in this company can be invoked.",
        hint: "Hire an agent, or un-pause an existing one — nothing will run until at least one agent is invokable.",
        agentIds: [],
      },
    ];
  },
};

const orgChainValid: PreflightCheck = {
  name: "org_chain_invalid",
  run(ctx) {
    const findings: PreflightFinding[] = [];
    for (const agent of ctx.agents) {
      const health = getAgentOrgChainHealth({ agent, agents: ctx.agents });
      if (health.status === "healthy") continue;
      findings.push({
        code: "org_chain_invalid",
        level: "error",
        message: `${agent.name}'s reporting chain is invalid (${health.reason}).`,
        // The shared helper already computes operator-facing repair guidance;
        // duplicating that wording here would let the two drift apart.
        hint: health.repairGuidance ?? `Fix ${agent.name}'s manager assignment.`,
        agentIds: [agent.id],
      });
    }
    return findings;
  },
};

const adapterAvailable: PreflightCheck = {
  name: "adapter_unavailable",
  run(ctx) {
    const findings: PreflightFinding[] = [];
    for (const agent of invokableAgents(ctx)) {
      if (ctx.availableAdapterTypes.has(agent.adapterType)) continue;
      findings.push({
        code: "adapter_unavailable",
        level: "error",
        message: `${agent.name} is bound to adapter "${agent.adapterType}", which is not registered or is disabled.`,
        hint: `Enable the "${agent.adapterType}" adapter, or point ${agent.name} at an adapter that is available.`,
        agentIds: [agent.id],
      });
    }
    return findings;
  },
};

const requiredSecretsBound: PreflightCheck = {
  name: "required_secret_unbound",
  run(ctx) {
    const findings: PreflightFinding[] = [];
    for (const binding of ctx.secretBindings) {
      if (!binding.required || binding.hasReadableVersion) continue;
      const label = binding.label ?? binding.configPath;
      findings.push({
        code: "required_secret_unbound",
        level: "error",
        message: `Required secret "${label}" has no readable version.`,
        hint: `Set a value for "${label}" — the run will fail at ${binding.configPath} without it.`,
        agentIds: binding.targetType === "agent" ? [binding.targetId] : [],
      });
    }
    return findings;
  },
};

const budgetConfigured: PreflightCheck = {
  name: "no_budget_policy",
  run(ctx) {
    if (ctx.budgetPolicies.some((policy) => policy.isActive)) return [];
    return [
      {
        code: "no_budget_policy",
        level: "warn",
        message: "No active budget policy — spend on this company is unbounded.",
        hint: "Set a budget so a runaway loop cannot spend without a ceiling.",
        agentIds: [],
      },
    ];
  },
};

const budgetCoversOneRun: PreflightCheck = {
  name: "budget_below_one_run",
  run(ctx) {
    // Without history there is no defensible per-run figure. Guessing one and
    // failing a launch on it would be worse than staying silent.
    if (ctx.medianRunCostCents === null) return [];

    const findings: PreflightFinding[] = [];
    for (const policy of ctx.budgetPolicies) {
      if (!policy.isActive) continue;
      const remaining = policy.amountCents - policy.observedCents;
      if (remaining >= ctx.medianRunCostCents) continue;
      findings.push({
        code: "budget_below_one_run",
        level: "error",
        message: `The ${policy.scopeType} budget has ${remaining}¢ left, below the ${ctx.medianRunCostCents}¢ median cost of a single run.`,
        hint: "Raise the budget or reset the window — the next run will be refused before it starts.",
        agentIds: [],
      });
    }
    return findings;
  },
};

const costHistoryPresent: PreflightCheck = {
  name: "no_cost_history",
  run(ctx) {
    if (ctx.costEventCount > 0) return [];
    return [
      {
        code: "no_cost_history",
        level: "info",
        message: "No cost history yet, so spend projection is unavailable.",
        hint: "This resolves itself after the first few runs; no action needed.",
        agentIds: [],
      },
    ];
  },
};

const agentsHaveWork: PreflightCheck = {
  name: "agent_without_work",
  run(ctx) {
    const findings: PreflightFinding[] = [];
    for (const agent of invokableAgents(ctx)) {
      if (agent.openIssueCount > 0) continue;
      findings.push({
        code: "agent_without_work",
        level: "warn",
        message: `${agent.name} is invokable but has nothing assigned.`,
        hint: `Assign ${agent.name} an issue, or pause it so it is not woken for no reason.`,
        agentIds: [agent.id],
      });
    }
    return findings;
  },
};

/**
 * Deliberately absent: goal-linkage and orphan-work checks. Combo-03's health
 * sentinel (`detectGoalDrift`) already owns those, and two systems reporting
 * the same problem in different words is worse than one reporting it well.
 * Preflight's scope is launch-blocking *configuration*.
 */
export const PREFLIGHT_CHECKS: PreflightCheck[] = [
  noInvokableAgents,
  orgChainValid,
  adapterAvailable,
  requiredSecretsBound,
  budgetConfigured,
  budgetCoversOneRun,
  costHistoryPresent,
  agentsHaveWork,
];
// [END: module]
