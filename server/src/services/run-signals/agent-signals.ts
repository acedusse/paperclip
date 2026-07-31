/**
 * FILE: server/src/services/run-signals/agent-signals.ts
 * ABOUT: Batched per-agent run aggregates for Combo-03 idea 044.
 *
 * SECTIONS:
 *   [TAG: module] - agent-signals.ts (run-signals module).
 */
// ==========================================
// [META: module]
// INTENT: Rolling terminal-run outcomes per agent over an explicit window.
// PSEUDOCODE: 1. Group terminal runs by agent and status. 2. Fold into signals.
// JSON_FLOW: {"file": "server/src/services/run-signals/agent-signals.ts", "imports": "drizzle-orm, @paperclipai/db", "exports": "getAgentRunSignals"}
// ==========================================
// [START: module]
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns } from "@paperclipai/db";
import type { AgentRunSignals } from "@paperclipai/shared";

/**
 * The window is explicit and has no default. A silent default is how two
 * detectors end up disagreeing about the same agent.
 */
export interface AgentSignalWindow {
  since: Date;
}

export async function getAgentRunSignals(
  db: Db,
  companyId: string,
  agentIds: string[],
  window: AgentSignalWindow,
): Promise<Map<string, AgentRunSignals>> {
  const result = new Map<string, AgentRunSignals>();
  if (agentIds.length === 0) return result;

  const rows = await db
    .select({
      agentId: heartbeatRuns.agentId,
      status: heartbeatRuns.status,
      count: sql<number>`count(*)::int`,
      retried: sql<number>`count(*) filter (where ${heartbeatRuns.retryOfRunId} is not null)::int`,
    })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, companyId),
        inArray(heartbeatRuns.agentId, agentIds),
        gte(
          sql`coalesce(${heartbeatRuns.startedAt}, ${heartbeatRuns.createdAt})`,
          window.since,
        ),
      ),
    )
    .groupBy(heartbeatRuns.agentId, heartbeatRuns.status);

  for (const row of rows) {
    const existing = result.get(row.agentId) ?? {
      agentId: row.agentId,
      runCount: 0,
      succeededCount: 0,
      failedCount: 0,
      retriedRunCount: 0,
    };
    existing.runCount += row.count;
    existing.retriedRunCount += row.retried;
    // "failed" is deliberately narrow: cancelled and timed_out are operator or
    // policy outcomes, not the agent being unreliable, and counting them would
    // make a wind-down look like a defect.
    if (row.status === "succeeded") existing.succeededCount += row.count;
    else if (row.status === "failed") existing.failedCount += row.count;
    result.set(row.agentId, existing);
  }

  return result;
}
// [END: module]
