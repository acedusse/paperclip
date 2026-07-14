/**
 * FILE: server/src/services/auto-approve-policy.ts
 * ABOUT: auto-approve-policy.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - pure auto-approve matcher + DB-backed policy service.
 */
// ==========================================
// [META: module]
// INTENT: Decide whether an approval matches an active per-company auto-approve allowlist policy.
// PSEUDOCODE: 1. Pure matcher over (context, policies). 2. DB service: CRUD + evaluateForApproval.
// JSON_FLOW: {"file": "server/src/services/auto-approve-policy.ts", "imports": "approval-risk, @paperclipai/db", "exports": "evaluateAutoApprove, autoApprovePolicyService"}
// ==========================================
// [START: module]
import { bandRank, type RiskBand } from "./approval-risk.js";

export type AutoApprovePolicy = {
  id: string;
  agentId: string;
  approvalType: string;
  maxBand: RiskBand;
  maxSpendCents: number;
  requireNoSecrets: boolean;
};

export type AutoApproveContext = {
  approval: { type: string; requestedByAgentId: string | null; payload: Record<string, unknown> };
  risk: { band: RiskBand; reasons: string[] } | null;
  impliedSpendCents: number;
  hasSecretsOrSensitive: boolean;
};

export function evaluateAutoApprove(
  ctx: AutoApproveContext,
  policies: AutoApprovePolicy[],
): { matched: AutoApprovePolicy | null; reasons: string[] } {
  if (!ctx.risk) return { matched: null, reasons: ["no risk snapshot — human decides"] };
  for (const p of policies) {
    if (p.approvalType !== ctx.approval.type) continue;
    if (p.agentId !== ctx.approval.requestedByAgentId) continue;
    if (bandRank(ctx.risk.band) > bandRank(p.maxBand)) continue;
    if (ctx.impliedSpendCents > p.maxSpendCents) continue;
    if (p.requireNoSecrets && ctx.hasSecretsOrSensitive) continue;
    return {
      matched: p,
      reasons: [
        `agent ${p.agentId} allowlisted for ${p.approvalType}`,
        `band ${ctx.risk.band} ≤ ${p.maxBand}`,
        `spend ${ctx.impliedSpendCents} ≤ ${p.maxSpendCents}`,
      ],
    };
  }
  return { matched: null, reasons: ["no active policy matched"] };
}
// [END: module]
