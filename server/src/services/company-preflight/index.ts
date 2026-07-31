/**
 * FILE: server/src/services/company-preflight/index.ts
 * ABOUT: Combo-10 Phase 1 — load the company snapshot and run the preflight checks.
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (company-preflight module).
 */
// ==========================================
// [META: module]
// INTENT: Turn a company's stored config into a launch-readiness report.
// PSEUDOCODE: 1. Load snapshot. 2. Run checks. 3. Roll up status.
// JSON_FLOW: {"file": "server/src/services/company-preflight/index.ts", "imports": "drizzle-orm, @paperclipai/db", "exports": "companyPreflightService"}
// ==========================================
// [START: module]
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  budgetPolicies,
  companySecretBindings,
  companySecretVersions,
  costEvents,
  issues,
} from "@paperclipai/db";
import type { PreflightFinding, PreflightReport } from "@paperclipai/shared";
import { listEnabledServerAdapters } from "../../adapters/registry.js";
import { computeObservedAmount } from "../budgets.js";
import { PREFLIGHT_CHECKS, type PreflightContext } from "./checks.js";

export { PREFLIGHT_CHECKS } from "./checks.js";
export type { PreflightCheck, PreflightContext } from "./checks.js";

const LEVEL_RANK = { info: 0, warn: 1, error: 2 } as const;

/** Issue statuses that represent live, assignable work. */
const OPEN_ISSUE_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"];

export async function loadPreflightContext(db: Db, companyId: string): Promise<PreflightContext> {
  const [agentRows, bindingRows, policyRows, costRow] = await Promise.all([
    db
      .select({
        id: agents.id,
        companyId: agents.companyId,
        name: agents.name,
        status: agents.status,
        reportsTo: agents.reportsTo,
        adapterType: agents.adapterType,
      })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), notInArray(agents.status, ["terminated"]))),
    db
      .select({
        label: companySecretBindings.label,
        configPath: companySecretBindings.configPath,
        targetType: companySecretBindings.targetType,
        targetId: companySecretBindings.targetId,
        required: companySecretBindings.required,
        secretId: companySecretBindings.secretId,
        versionCount: sql<number>`(
          select count(*)::int from ${companySecretVersions}
          where ${companySecretVersions.secretId} = ${companySecretBindings.secretId}
        )`,
      })
      .from(companySecretBindings)
      .where(eq(companySecretBindings.companyId, companyId)),
    db
      .select({
        scopeType: budgetPolicies.scopeType,
        scopeId: budgetPolicies.scopeId,
        amount: budgetPolicies.amount,
        isActive: budgetPolicies.isActive,
        metric: budgetPolicies.metric,
        windowKind: budgetPolicies.windowKind,
      })
      .from(budgetPolicies)
      .where(eq(budgetPolicies.companyId, companyId)),
    db
      .select({
        count: sql<number>`count(*)::int`,
        median: sql<
          number | null
        >`percentile_cont(0.5) within group (order by ${costEvents.costCents})`,
      })
      .from(costEvents)
      .where(eq(costEvents.companyId, companyId))
      .then((rows) => rows[0] ?? { count: 0, median: null }),
  ]);

  const agentIds = agentRows.map((row) => row.id);
  const openCounts = agentIds.length
    ? await db
        .select({ agentId: issues.assigneeAgentId, count: sql<number>`count(*)::int` })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            inArray(issues.assigneeAgentId, agentIds),
            inArray(issues.status, OPEN_ISSUE_STATUSES),
          ),
        )
        .groupBy(issues.assigneeAgentId)
    : [];
  const openByAgent = new Map(openCounts.map((row) => [row.agentId as string, row.count]));

  // Budgets are stored as a policy plus observed spend computed elsewhere;
  // reuse that helper so preflight and enforcement agree on "spent".
  const policies = await Promise.all(
    policyRows.map(async (policy) => ({
      scopeType: policy.scopeType,
      scopeId: policy.scopeId,
      amountCents: policy.amount,
      isActive: policy.isActive,
      observedCents: await computeObservedAmount(db, {
        companyId,
        scopeType: policy.scopeType,
        scopeId: policy.scopeId,
        metric: policy.metric,
        windowKind: policy.windowKind,
      } as Parameters<typeof computeObservedAmount>[1]),
    })),
  );

  return {
    companyId,
    agents: agentRows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      status: row.status,
      reportsTo: row.reportsTo,
      adapterType: row.adapterType,
      openIssueCount: openByAgent.get(row.id) ?? 0,
    })),
    availableAdapterTypes: new Set(listEnabledServerAdapters().map((adapter) => adapter.type)),
    secretBindings: bindingRows.map((row) => ({
      label: row.label,
      configPath: row.configPath,
      targetType: row.targetType,
      targetId: row.targetId,
      required: row.required,
      hasReadableVersion: row.versionCount > 0,
    })),
    budgetPolicies: policies,
    medianRunCostCents: costRow.median === null ? null : Math.round(Number(costRow.median)),
    costEventCount: costRow.count,
  };
}

export function companyPreflightService(db: Db) {
  async function run(companyId: string, now: Date = new Date()): Promise<PreflightReport> {
    const ctx = await loadPreflightContext(db, companyId);

    const findings: PreflightFinding[] = [];
    for (const check of PREFLIGHT_CHECKS) {
      try {
        findings.push(...check.run(ctx));
      } catch (err) {
        // One broken check must not deny the operator the other seven.
        findings.push({
          code: "check_failed",
          level: "info",
          message: `Preflight check "${check.name}" could not run.`,
          hint: "The remaining checks still ran; this is a Paperclip bug, not a company misconfiguration.",
          agentIds: [],
        });
      }
    }

    findings.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);

    const hasError = findings.some((finding) => finding.level === "error");
    const hasWarn = findings.some((finding) => finding.level === "warn");

    return {
      companyId,
      generatedAt: now.toISOString(),
      status: hasError ? "fail" : hasWarn ? "warn" : "pass",
      findings,
    };
  }

  return { run };
}
// [END: module]
