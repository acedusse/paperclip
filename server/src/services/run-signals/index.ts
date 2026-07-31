/**
 * FILE: server/src/services/run-signals/index.ts
 * ABOUT: Facade for the Combo-03 run-signal read model.
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (run-signals module).
 */
// ==========================================
// [META: module]
// INTENT: Bind the read model to a Db handle, matching the repo's xService(db) pattern.
// PSEUDOCODE: 1. Accept Db. 2. Return bound readers.
// JSON_FLOW: {"file": "server/src/services/run-signals/index.ts", "imports": "./issue-signals.js", "exports": "runSignalsService"}
// ==========================================
// [START: module]
import type { Db } from "@paperclipai/db";
import type { IssueRunSignalScope } from "@paperclipai/shared";
import { getIssueRunSignals } from "./issue-signals.js";

export { getIssueRunSignals } from "./issue-signals.js";
export {
  ACTIVE_RUN_STATUSES,
  isActiveRunStatus,
  isTerminalRunStatus,
  issueRunScopeSql,
  MAX_RUNS_FOR_STREAK,
  TERMINAL_RUN_STATUSES,
} from "./scope.js";

export function runSignalsService(db: Db) {
  return {
    issueSignals(companyId: string, scopes: IssueRunSignalScope[], now: Date) {
      return getIssueRunSignals(db, companyId, scopes, now);
    },
  };
}
// [END: module]
