/**
 * FILE: server/src/__tests__/company-preflight-checks.test.ts
 * ABOUT: company-preflight-checks.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - company-preflight-checks.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: company-preflight-checks.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/company-preflight-checks.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  PREFLIGHT_CHECKS,
  type PreflightAgent,
  type PreflightContext,
} from "../services/company-preflight/checks.ts";

function agent(overrides: Partial<PreflightAgent> & { id: string }): PreflightAgent {
  return {
    companyId: "c1",
    name: overrides.id.toUpperCase(),
    status: "idle",
    reportsTo: null,
    adapterType: "codex_local",
    openIssueCount: 1,
    ...overrides,
  };
}

function context(overrides: Partial<PreflightContext> = {}): PreflightContext {
  return {
    companyId: "c1",
    agents: [agent({ id: "a1" })],
    availableAdapterTypes: new Set(["codex_local"]),
    secretBindings: [],
    budgetPolicies: [
      { scopeType: "company", scopeId: "c1", amountCents: 10_000, observedCents: 0, isActive: true },
    ],
    medianRunCostCents: 50,
    costEventCount: 10,
    runCostPercentiles: { p10Cents: 30, medianCents: 50, p90Cents: 90, sampleSize: 10 },
    ...overrides,
  };
}

function runAll(ctx: PreflightContext) {
  return PREFLIGHT_CHECKS.flatMap((check) => check.run(ctx));
}

function codes(ctx: PreflightContext) {
  return runAll(ctx).map((finding) => finding.code).sort();
}

describe("preflight checks", () => {
  it("passes a well-configured company with no findings", () => {
    expect(runAll(context())).toEqual([]);
  });

  it("every finding carries an actionable hint", () => {
    // A finding the operator cannot act on is noise; this guards the contract
    // across all eight checks at once.
    const findings = runAll(
      context({
        agents: [agent({ id: "a1", adapterType: "ghost", openIssueCount: 0 })],
        secretBindings: [
          {
            label: "OPENAI_API_KEY", configPath: "env.OPENAI_API_KEY", targetType: "agent",
            targetId: "a1", required: true, hasReadableVersion: false,
          },
        ],
        budgetPolicies: [],
        costEventCount: 0,
        medianRunCostCents: null,
        runCostPercentiles: null,
      }),
    );

    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.hint.length).toBeGreaterThan(0);
      expect(finding.message.length).toBeGreaterThan(0);
    }
  });

  describe("no_invokable_agents", () => {
    it("errors when every agent is paused", () => {
      expect(codes(context({ agents: [agent({ id: "a1", status: "paused" })] })))
        .toContain("no_invokable_agents");
    });

    it("errors when there are no agents at all", () => {
      expect(codes(context({ agents: [] }))).toContain("no_invokable_agents");
    });

    it("passes when one agent is invokable", () => {
      expect(codes(context())).not.toContain("no_invokable_agents");
    });
  });

  describe("org_chain_invalid", () => {
    it("flags a reporting cycle", () => {
      const found = codes(
        context({
          agents: [
            agent({ id: "a1", reportsTo: "a2" }),
            agent({ id: "a2", reportsTo: "a1" }),
          ],
        }),
      );
      expect(found).toContain("org_chain_invalid");
    });

    it("flags a manager that does not exist", () => {
      expect(codes(context({ agents: [agent({ id: "a1", reportsTo: "ghost" })] })))
        .toContain("org_chain_invalid");
    });

    it("passes a normal two-level chain", () => {
      const found = codes(
        context({ agents: [agent({ id: "boss" }), agent({ id: "a1", reportsTo: "boss" })] }),
      );
      expect(found).not.toContain("org_chain_invalid");
    });
  });

  describe("adapter_unavailable", () => {
    it("errors when the agent's adapter is not registered", () => {
      expect(codes(context({ agents: [agent({ id: "a1", adapterType: "ghost" })] })))
        .toContain("adapter_unavailable");
    });

    it("ignores paused agents, which will not run anyway", () => {
      const found = codes(
        context({
          agents: [agent({ id: "a1" }), agent({ id: "a2", adapterType: "ghost", status: "paused" })],
        }),
      );
      expect(found).not.toContain("adapter_unavailable");
    });
  });

  describe("required_secret_unbound", () => {
    const binding = (overrides: Partial<PreflightContext["secretBindings"][number]> = {}) => ({
      label: "OPENAI_API_KEY",
      configPath: "env.OPENAI_API_KEY",
      targetType: "agent",
      targetId: "a1",
      required: true,
      hasReadableVersion: false,
      ...overrides,
    });

    it("errors on a required binding with no version", () => {
      expect(codes(context({ secretBindings: [binding()] }))).toContain("required_secret_unbound");
    });

    it("ignores an optional binding with no version", () => {
      expect(codes(context({ secretBindings: [binding({ required: false })] })))
        .not.toContain("required_secret_unbound");
    });

    it("ignores a required binding that has a version", () => {
      expect(codes(context({ secretBindings: [binding({ hasReadableVersion: true })] })))
        .not.toContain("required_secret_unbound");
    });

    it("attributes an agent-targeted binding to that agent", () => {
      const finding = runAll(context({ secretBindings: [binding()] }))
        .find((f) => f.code === "required_secret_unbound");
      expect(finding!.agentIds).toEqual(["a1"]);
    });
  });

  describe("budget checks", () => {
    it("warns when there is no active budget policy", () => {
      expect(codes(context({ budgetPolicies: [] }))).toContain("no_budget_policy");
    });

    it("treats an inactive policy as no policy", () => {
      const found = codes(
        context({
          budgetPolicies: [
            { scopeType: "company", scopeId: "c1", amountCents: 10_000, observedCents: 0, isActive: false },
          ],
        }),
      );
      expect(found).toContain("no_budget_policy");
    });

    it("errors when the remaining budget cannot cover one run", () => {
      const found = codes(
        context({
          budgetPolicies: [
            { scopeType: "company", scopeId: "c1", amountCents: 100, observedCents: 80, isActive: true },
          ],
          medianRunCostCents: 50,
        }),
      );
      expect(found).toContain("budget_below_one_run");
    });

    it("stays silent about coverage when there is no cost history", () => {
      // Guessing a per-run figure and failing a launch on it would be worse
      // than saying nothing.
      const found = codes(
        context({
          budgetPolicies: [
            { scopeType: "company", scopeId: "c1", amountCents: 1, observedCents: 0, isActive: true },
          ],
          medianRunCostCents: null,
          costEventCount: 0,
          runCostPercentiles: null,
        }),
      );
      expect(found).not.toContain("budget_below_one_run");
    });

    it("reports missing cost history as info, not a failure", () => {
      const finding = runAll(context({ costEventCount: 0, medianRunCostCents: null, runCostPercentiles: null }))
        .find((f) => f.code === "no_cost_history");
      expect(finding!.level).toBe("info");
    });
  });

  describe("agent_without_work", () => {
    it("warns about an invokable agent with nothing assigned", () => {
      expect(codes(context({ agents: [agent({ id: "a1", openIssueCount: 0 })] })))
        .toContain("agent_without_work");
    });

    it("does not warn about a paused agent with nothing assigned", () => {
      const found = codes(
        context({ agents: [agent({ id: "a1" }), agent({ id: "a2", status: "paused", openIssueCount: 0 })] }),
      );
      expect(found).not.toContain("agent_without_work");
    });
  });

  it("does not duplicate combo-03's goal-drift checks", () => {
    // Preflight owns launch-blocking configuration; goal linkage belongs to
    // the health sentinel. Two systems reporting the same problem in
    // different words is worse than one reporting it well.
    const allCodes = PREFLIGHT_CHECKS.map((check) => check.name);
    expect(allCodes).not.toContain("orphan_issue");
    expect(allCodes).not.toContain("goal_without_work");
  });
});
// [END: module]
