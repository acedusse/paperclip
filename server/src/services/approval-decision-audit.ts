/**
 * FILE: server/src/services/approval-decision-audit.ts
 * ABOUT: approval-decision-audit.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - approval-decision-audit.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: approval-decision-audit.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/approval-decision-audit.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { Db } from "@paperclipai/db";
import { logActivity } from "./activity-log.js";
import type { DecisionMethod } from "./approval-authority.js";
import type { RiskBand } from "./approval-risk.js";

/**
 * Record a unified cockpit-audit entry for an approval decision.
 *
 * This is ADDITIVE: it does not replace the existing `approval.approved` /
 * `approval.rejected` activity entries or requester-wakeup logic in
 * `routes/approvals.ts`. `approval.decision` is a new, consistently-shaped
 * activity row that the review cockpit can query regardless of decision
 * outcome or method.
 */
export async function recordDecision(
  db: Db,
  input: {
    approvalId: string;
    companyId: string;
    actor: { actorType: "user" | "agent" | "system"; actorId: string; agentId?: string | null };
    method: DecisionMethod;
    outcome: "approved" | "rejected" | "revision_requested";
    risk?: { score: number; band: RiskBand } | null;
    note?: string | null;
    // Combo-05 Phase 4a: extra attribution fields (e.g. delegated_human's
    // { grantId, onBehalfOf }) merged into the audit row's details. Never
    // allowed to clobber the fixed fields below.
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await logActivity(db, {
    companyId: input.companyId,
    actorType: input.actor.actorType,
    actorId: input.actor.actorId,
    agentId: input.actor.agentId ?? null,
    action: "approval.decision",
    entityType: "approval",
    entityId: input.approvalId,
    details: {
      ...input.details,
      method: input.method,
      outcome: input.outcome,
      riskBand: input.risk?.band ?? null,
      riskScore: input.risk?.score ?? null,
      note: input.note ?? null,
    },
  });
}
// [END: module]
