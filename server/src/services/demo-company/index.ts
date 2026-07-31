/**
 * FILE: server/src/services/demo-company/index.ts
 * ABOUT: Combo-10 Phase 3 — instantiate the demo company from its blueprint.
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (demo-company module).
 */
// ==========================================
// [META: module]
// INTENT: Turn the demo blueprint plus operator values into a real, running company.
// PSEUDOCODE: 1. Resolve variables. 2. Substitute. 3. Create company/goal/agents/issues/budget.
// JSON_FLOW: {"file": "server/src/services/demo-company/index.ts", "imports": "blueprint, drizzle-orm", "exports": "demoCompanyService, planDemoCompany"}
// ==========================================
// [START: module]
import type { Db } from "@paperclipai/db";
import { agents, budgetPolicies, companies, goals, issues } from "@paperclipai/db";
import type { BlueprintValidationIssue } from "@paperclipai/shared";
import {
  findUndeclaredPlaceholders,
  resolveBlueprintVariables,
  substituteBlueprintVariables,
} from "../blueprints/variables.js";
import { applyWorkTemplate } from "../work-templates/index.js";
import { DEMO_BLUEPRINT, DEMO_TEMPLATE, type DemoTemplate } from "./blueprint.js";

export { DEMO_BLUEPRINT, DEMO_TEMPLATE } from "./blueprint.js";

export interface DemoCompanyPlan {
  ok: boolean;
  issues: BlueprintValidationIssue[];
  resolved: DemoTemplate | null;
}

/**
 * Resolve and substitute without writing anything — the dry-run preview the
 * combo's "launch with eyes open" philosophy asks for. The wizard calls this
 * first and only commits once `ok` is true.
 */
export function planDemoCompany(supplied: Record<string, unknown>): DemoCompanyPlan {
  const resolution = resolveBlueprintVariables(DEMO_BLUEPRINT, supplied);

  // A placeholder the manifest never declares would survive substitution and
  // end up visible in the created company, so it is a planning error too.
  const undeclared = findUndeclaredPlaceholders(DEMO_TEMPLATE, DEMO_BLUEPRINT).map((key) => ({
    variableKey: key,
    message: `The demo template references "{{${key}}}", which the blueprint does not declare.`,
  }));

  const allIssues = [...resolution.issues, ...undeclared];
  if (allIssues.length > 0) return { ok: false, issues: allIssues, resolved: null };

  return {
    ok: true,
    issues: [],
    resolved: substituteBlueprintVariables(DEMO_TEMPLATE, resolution.values),
  };
}

function issuePrefixFor(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return (letters.slice(0, 4) || "DEMO").padEnd(3, "X");
}

export function demoCompanyService(db: Db) {
  /**
   * Create the demo company. Every write happens in one transaction: a
   * half-built demo — a company with no agents, or agents with no work — is a
   * worse first impression than a clear failure.
   */
  async function create(supplied: Record<string, unknown> = {}) {
    const plan = planDemoCompany(supplied);
    if (!plan.ok || !plan.resolved) {
      return { ok: false as const, issues: plan.issues, companyId: null };
    }
    const spec = plan.resolved;

    const companyId = await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values({
          name: spec.companyName,
          issuePrefix: issuePrefixFor(spec.companyName),
          requireBoardApprovalForNewAgents: false,
        })
        .returning({ id: companies.id });
      const newCompanyId = company!.id;

      const [goal] = await tx
        .insert(goals)
        .values({
          companyId: newCompanyId,
          title: spec.goalTitle,
          level: "company",
          status: "active",
        })
        .returning({ id: goals.id });

      const agentIds: string[] = [];
      // Sequential, not parallel: a report's `reportsTo` must reference a
      // manager row that already exists.
      for (const agentSpec of spec.agents) {
        const [row] = await tx
          .insert(agents)
          .values({
            companyId: newCompanyId,
            name: agentSpec.name,
            role: agentSpec.role,
            title: agentSpec.title,
            status: "idle",
            reportsTo: agentSpec.reportsToIndex === null ? null : agentIds[agentSpec.reportsToIndex]!,
            adapterType: spec.adapterType,
            adapterConfig: {},
            runtimeConfig: {},
            permissions: {},
          })
          .returning({ id: agents.id });
        agentIds.push(row!.id);
      }

      const prefix = issuePrefixFor(spec.companyName);
      let issueNumber = 0;
      for (const issueSpec of spec.issues) {
        issueNumber += 1;
        // Route through the work template so the demo also shows what
        // acceptance criteria look like.
        const draft = applyWorkTemplate(
          { title: issueSpec.title, description: issueSpec.description },
          issueSpec.templateKind,
        );
        await tx.insert(issues).values({
          companyId: newCompanyId,
          title: draft.title,
          description: draft.description ?? null,
          status: "todo",
          priority: "medium",
          originKind: "manual",
          issueNumber,
          identifier: `${prefix}-${issueNumber}`,
          goalId: goal!.id,
          assigneeAgentId: agentIds[issueSpec.assigneeIndex]!,
        });
      }

      const budgetCents = Number(spec.budgetCents);
      if (Number.isFinite(budgetCents) && budgetCents > 0) {
        await tx.insert(budgetPolicies).values({
          companyId: newCompanyId,
          scopeType: "company",
          scopeId: newCompanyId,
          metric: "billed_cents",
          windowKind: "monthly",
          amount: budgetCents,
          isActive: true,
        });
      }

      return newCompanyId;
    });

    return { ok: true as const, issues: [], companyId };
  }

  return { create, plan: planDemoCompany };
}
// [END: module]
