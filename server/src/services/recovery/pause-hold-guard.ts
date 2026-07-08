/**
 * FILE: server/src/services/recovery/pause-hold-guard.ts
 * ABOUT: pause-hold-guard.ts (recovery module).
 *
 * SECTIONS:
 *   [TAG: module] - pause-hold-guard.ts (recovery module).
 */
// ==========================================
// [META: module]
// INTENT: pause-hold-guard.ts (recovery module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/recovery/pause-hold-guard.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { Db } from "@paperclipai/db";
import { issueTreeControlService } from "../issue-tree-control.js";

type IssueTreeControlService = ReturnType<typeof issueTreeControlService>;

export async function isAutomaticRecoverySuppressedByPauseHold(
  db: Db,
  companyId: string,
  issueId: string,
  treeControlSvc: IssueTreeControlService = issueTreeControlService(db),
) {
  const activePauseHold = await treeControlSvc.getActivePauseHoldGate(companyId, issueId);
  return Boolean(activePauseHold);
}
// [END: module]
