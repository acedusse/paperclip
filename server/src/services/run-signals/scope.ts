/**
 * FILE: server/src/services/run-signals/scope.ts
 * ABOUT: Run<->issue attribution predicate and run status sets, shared by Health Sentinel detectors.
 *
 * SECTIONS:
 *   [TAG: module] - scope.ts (run-signals module).
 */
// ==========================================
// [META: module]
// INTENT: Single owned definition of "which runs belong to this issue".
// PSEUDOCODE: 1. Load dependencies. 2. Define predicate + status sets. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/run-signals/scope.ts", "imports": "drizzle-orm, @paperclipai/db", "exports": "issueRunScopeSql, status sets"}
// ==========================================
// [START: module]
import { sql } from "drizzle-orm";
import { heartbeatRuns } from "@paperclipai/db";

export const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "cancelled", "timed_out"] as const;
export const ACTIVE_RUN_STATUSES = ["queued", "running", "scheduled_retry"] as const;

/**
 * Bounds the newest-first walk used for the no-comment streak. Not an
 * incidental page size: the streak is only meaningful over a bounded window.
 */
export const MAX_RUNS_FOR_STREAK = 100;

export function isTerminalRunStatus(status: string): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

export function isActiveRunStatus(status: string): boolean {
  return (ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
}

/**
 * Run -> issue attribution was never normalised onto a column, so three
 * contextSnapshot key variants are in use across adapters and the recovery
 * paths. All three must be matched; dropping one silently under-counts a
 * detector's evidence. This is the single definition — do not inline it.
 */
export function issueRunScopeSql(issueId: string) {
  return sql`(
    ${heartbeatRuns.contextSnapshot}->>'issueId' = ${issueId}
    or ${heartbeatRuns.contextSnapshot}->>'taskId' = ${issueId}
    or ${heartbeatRuns.contextSnapshot}->>'taskKey' = ${issueId}
  )`;
}
// [END: module]
