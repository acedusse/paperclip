/**
 * FILE: server/src/services/run-signals/issue-signals.ts
 * ABOUT: Batched per-issue run aggregates for Combo-03 Health Sentinel detectors.
 *
 * SECTIONS:
 *   [TAG: module] - issue-signals.ts (run-signals module).
 */
// ==========================================
// [META: module]
// INTENT: Answer "what has this agent been doing on this issue" for many issues at once.
// PSEUDOCODE: 1. Load runs per scope. 2. Aggregate counts/windows. 3. Walk streak. 4. Attach cost.
// JSON_FLOW: {"file": "server/src/services/run-signals/issue-signals.ts", "imports": "drizzle-orm, @paperclipai/db", "exports": "getIssueRunSignals"}
// ==========================================
// [START: module]
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { costEvents, heartbeatRuns, issueComments } from "@paperclipai/db";
import type { IssueRunSignalScope, IssueRunSignals } from "@paperclipai/shared";
import { isActiveRunStatus, isTerminalRunStatus, issueRunScopeSql, MAX_RUNS_FOR_STREAK } from "./scope.js";

type RunRow = {
  id: string;
  agentId: string;
  status: string;
  effectiveAt: Date;
  issueId: string | null;
};

type CommentRow = {
  issueId: string;
  createdByRunId: string | null;
  authorAgentId: string | null;
  createdAt: Date;
};

function scopeKey(issueId: string, agentId: string) {
  return `${issueId}::${agentId}`;
}

/**
 * Per-issue run signals for a batch of (issue, agent) scopes.
 *
 * Every aggregate is one grouped query over the whole batch — never one query
 * per issue. Phase 2's bottleneck heatmap loads a whole company at once, so an
 * N+1 shape here would have to be rewritten later.
 *
 * Scopes with no matching runs are omitted from the returned Map rather than
 * mapped to a zero record: absence is the natural shape for a batch read, and
 * it keeps one unknown id from failing a whole heatmap.
 */
export async function getIssueRunSignals(
  db: Db,
  companyId: string,
  scopes: IssueRunSignalScope[],
  now: Date,
): Promise<Map<string, IssueRunSignals>> {
  const result = new Map<string, IssueRunSignals>();
  if (scopes.length === 0) return result;

  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

  // One predicate covering every (issue, agent) pair, so the whole batch is a
  // single scan rather than one query per issue.
  const scopePredicate = or(
    ...scopes.map((scope) => and(eq(heartbeatRuns.agentId, scope.agentId), issueRunScopeSql(scope.issueId))),
  );

  // `issueId` is projected back out of contextSnapshot so rows can be bucketed
  // without re-testing every scope in JS.
  const issueIdExpr = sql<string | null>`coalesce(
    ${heartbeatRuns.contextSnapshot}->>'issueId',
    ${heartbeatRuns.contextSnapshot}->>'taskId',
    ${heartbeatRuns.contextSnapshot}->>'taskKey'
  )`;

  const runRows = (await db
    .select({
      id: heartbeatRuns.id,
      agentId: heartbeatRuns.agentId,
      status: heartbeatRuns.status,
      // A queued run has no startedAt but is still real work in the window.
      effectiveAt: sql<Date>`coalesce(${heartbeatRuns.startedAt}, ${heartbeatRuns.createdAt})`,
      issueId: issueIdExpr,
    })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, companyId), scopePredicate))
    .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id))) as RunRow[];

  // Bucket by (issue, agent): a run matched by the batch predicate may belong
  // to a different scope's agent, so the pair must be re-checked here.
  const runsByScope = new Map<string, RunRow[]>();
  for (const row of runRows) {
    if (!row.issueId) continue;
    const key = scopeKey(row.issueId, row.agentId);
    const bucket = runsByScope.get(key);
    if (bucket) {
      // Newest-first from the ORDER BY; the cap bounds the streak walk.
      if (bucket.length < MAX_RUNS_FOR_STREAK) bucket.push(row);
    } else {
      runsByScope.set(key, [row]);
    }
  }

  const allRunIds = runRows.map((row) => row.id);
  const commentRows: CommentRow[] = allRunIds.length
    ? ((await db
        .select({
          issueId: issueComments.issueId,
          createdByRunId: issueComments.createdByRunId,
          authorAgentId: issueComments.authorAgentId,
          createdAt: issueComments.createdAt,
        })
        .from(issueComments)
        .where(
          and(eq(issueComments.companyId, companyId), inArray(issueComments.createdByRunId, allRunIds)),
        )) as CommentRow[])
    : [];

  const commentingRunIds = new Set<string>();
  for (const row of commentRows) {
    if (row.createdByRunId) commentingRunIds.add(row.createdByRunId);
  }

  const matchedIssueIds = [...new Set([...runsByScope.keys()].map((key) => key.split("::")[0]!))];
  const costRows = matchedIssueIds.length
    ? await db
        .select({
          issueId: costEvents.issueId,
          costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
        })
        .from(costEvents)
        .where(and(eq(costEvents.companyId, companyId), inArray(costEvents.issueId, matchedIssueIds)))
        .groupBy(costEvents.issueId)
    : [];
  const costByIssue = new Map(costRows.map((row) => [row.issueId as string, row.costCents]));

  for (const scope of scopes) {
    const runs = runsByScope.get(scopeKey(scope.issueId, scope.agentId));
    if (!runs || runs.length === 0) continue;

    // Newest-first walk over terminal runs, stopping at the first that spoke.
    // Order matters — a plain count would be wrong.
    let noCommentStreak = 0;
    for (const run of runs) {
      if (!isTerminalRunStatus(run.status)) continue;
      if (commentingRunIds.has(run.id)) break;
      noCommentStreak += 1;
    }

    // Only this agent's comments, and only those created by a run attributed
    // to this issue — matching the original inner-join semantics.
    const runIds = new Set(runs.map((run) => run.id));
    const scopedComments = commentRows.filter(
      (row) =>
        row.issueId === scope.issueId &&
        row.authorAgentId === scope.agentId &&
        row.createdByRunId !== null &&
        runIds.has(row.createdByRunId),
    );
    const commentsSince = (since: Date) =>
      scopedComments.filter((row) => new Date(row.createdAt) >= since).length;

    result.set(scope.issueId, {
      issueId: scope.issueId,
      agentId: scope.agentId,
      runIds: runs.map((run) => run.id),
      terminalRunCount: runs.filter((run) => isTerminalRunStatus(run.status)).length,
      activeRunCount: runs.filter((run) => isActiveRunStatus(run.status)).length,
      runCountLastHour: runs.filter((run) => new Date(run.effectiveAt) >= oneHourAgo).length,
      runCountLastSixHours: runs.filter((run) => new Date(run.effectiveAt) >= sixHoursAgo).length,
      commentCount: scopedComments.length,
      commentCountLastHour: commentsSince(oneHourAgo),
      commentCountLastSixHours: commentsSince(sixHoursAgo),
      noCommentStreak,
      costCents: costByIssue.get(scope.issueId) ?? 0,
    });
  }

  return result;
}
// [END: module]
