/**
 * FILE: server/src/services/health-sentinel/index.ts
 * ABOUT: Combo-03 Health Sentinel — loads company state and runs every detector.
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (health-sentinel module).
 */
// ==========================================
// [META: module]
// INTENT: One analyzer entry point producing one escalation contract.
// PSEUDOCODE: 1. Load company snapshot. 2. Run detectors. 3. Roll up status.
// JSON_FLOW: {"file": "server/src/services/health-sentinel/index.ts", "imports": "detectors, drizzle-orm", "exports": "healthSentinelService"}
// ==========================================
// [START: module]
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, goals, issuePlanDecompositions, issueRelations, issues } from "@paperclipai/db";
import type { HealthFinding, HealthReport } from "@paperclipai/shared";
import { getAgentRunSignals } from "../run-signals/agent-signals.js";
import { detectDeadlocks, type BlockerEdge, type DeadlockIssue } from "./deadlock.js";
import { detectDecompositionGaps, type DecompositionRecord } from "./decomposition.js";
import { detectGoalDrift, type DriftGoal, type DriftIssue } from "./goal-drift.js";
import { detectReliabilityBreaches, type ReliabilitySlo } from "./reliability.js";
import { rollUpAgentHeat } from "./heat.js";

export { detectDeadlocks, findBlockedDeadEnds, findBlockerCycles } from "./deadlock.js";
export { detectDecompositionGaps } from "./decomposition.js";
export { detectGoalDrift, findOrphanIssues, resolveIssueGoalId } from "./goal-drift.js";
export { detectReliabilityBreaches, DEFAULT_RELIABILITY_SLO } from "./reliability.js";
export { rollUpAgentHeat } from "./heat.js";

/** Reliability is judged over a rolling window, not all history. */
const DEFAULT_RELIABILITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const FINDING_LEVEL_RANK = { info: 0, warn: 1, error: 2 } as const;

export interface HealthSentinelOptions {
  now?: Date;
  reliabilitySlo?: ReliabilitySlo;
  reliabilityWindowMs?: number;
}

export function healthSentinelService(db: Db) {
  async function run(companyId: string, opts: HealthSentinelOptions = {}): Promise<HealthReport> {
    const now = opts.now ?? new Date();

    const [issueRows, goalRows, agentRows, decompositionRows] = await Promise.all([
      db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          status: issues.status,
          parentId: issues.parentId,
          goalId: issues.goalId,
          assigneeAgentId: issues.assigneeAgentId,
        })
        .from(issues)
        .where(eq(issues.companyId, companyId)),
      db
        .select({ id: goals.id, title: goals.title, status: goals.status, level: goals.level })
        .from(goals)
        .where(eq(goals.companyId, companyId)),
      db
        .select({ id: agents.id, name: agents.name, status: agents.status })
        .from(agents)
        .where(and(eq(agents.companyId, companyId), notInArray(agents.status, ["terminated"]))),
      db
        .select({
          id: issuePlanDecompositions.id,
          sourceIssueId: issuePlanDecompositions.sourceIssueId,
          status: issuePlanDecompositions.status,
          requestedChildCount: issuePlanDecompositions.requestedChildCount,
          childIssueIds: issuePlanDecompositions.childIssueIds,
        })
        .from(issuePlanDecompositions)
        .where(eq(issuePlanDecompositions.companyId, companyId)),
    ]);

    const issueIds = issueRows.map((row) => row.id);
    const relationRows = issueIds.length
      ? await db
          .select({ blockerId: issueRelations.issueId, blockedId: issueRelations.relatedIssueId })
          .from(issueRelations)
          .where(
            and(
              eq(issueRelations.companyId, companyId),
              eq(issueRelations.type, "blocks"),
              inArray(issueRelations.issueId, issueIds),
            ),
          )
      : [];

    const identifierById = new Map(issueRows.map((row) => [row.id, row.identifier]));

    const deadlockIssues: DeadlockIssue[] = issueRows.map((row) => ({
      id: row.id,
      identifier: row.identifier,
      status: row.status,
    }));
    const edges: BlockerEdge[] = relationRows.map((row) => ({
      blockerId: row.blockerId,
      blockedId: row.blockedId,
    }));
    const driftIssues: DriftIssue[] = issueRows.map((row) => ({
      id: row.id,
      identifier: row.identifier,
      status: row.status,
      parentId: row.parentId,
      goalId: row.goalId,
    }));
    const driftGoals: DriftGoal[] = goalRows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      level: row.level,
    }));
    const decompositions: DecompositionRecord[] = decompositionRows.map((row) => ({
      id: row.id,
      sourceIssueId: row.sourceIssueId,
      sourceIssueIdentifier: identifierById.get(row.sourceIssueId) ?? null,
      status: row.status,
      requestedChildCount: row.requestedChildCount,
      childIssueIds: Array.isArray(row.childIssueIds) ? row.childIssueIds : [],
    }));

    const windowMs = opts.reliabilityWindowMs ?? DEFAULT_RELIABILITY_WINDOW_MS;
    const agentSignals = await getAgentRunSignals(
      db,
      companyId,
      agentRows.map((row) => row.id),
      { since: new Date(now.getTime() - windowMs) },
    );

    const findings: HealthFinding[] = [
      ...detectDeadlocks(deadlockIssues, edges),
      ...detectGoalDrift(driftIssues, driftGoals),
      ...detectDecompositionGaps(decompositions),
      ...detectReliabilityBreaches(agentRows, agentSignals, opts.reliabilitySlo),
    ];

    // Most severe first — an operator reading top-down should hit the errors
    // before the warnings.
    findings.sort((a, b) => FINDING_LEVEL_RANK[b.level] - FINDING_LEVEL_RANK[a.level]);

    const assigneeByIssueId = new Map(issueRows.map((row) => [row.id, row.assigneeAgentId]));
    const heat = rollUpAgentHeat(findings, assigneeByIssueId);

    const hasError = findings.some((finding) => finding.level === "error");
    const hasWarn = findings.some((finding) => finding.level === "warn");

    return {
      companyId,
      generatedAt: now.toISOString(),
      status: hasError ? "unhealthy" : hasWarn ? "warn" : "healthy",
      findings,
      heat,
    };
  }

  return { run };
}
// [END: module]
