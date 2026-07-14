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
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { approvals, approvalRisk, autoApprovePolicies, type AutoApprovePolicyRow } from "@paperclipai/db";
import { bandRank, hasSensitiveBoundary, impliedSpendFromApproval, type RiskBand } from "./approval-risk.js";

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

function toPolicy(row: AutoApprovePolicyRow): AutoApprovePolicy {
  return {
    id: row.id,
    agentId: row.agentId,
    approvalType: row.approvalType,
    maxBand: row.maxBand as RiskBand,
    maxSpendCents: row.maxSpendCents,
    requireNoSecrets: row.requireNoSecrets,
  };
}

export function autoApprovePolicyService(db: Db) {
  async function listActiveRows(companyId: string): Promise<AutoApprovePolicyRow[]> {
    return db
      .select()
      .from(autoApprovePolicies)
      .where(and(eq(autoApprovePolicies.companyId, companyId), eq(autoApprovePolicies.isActive, true)))
      .orderBy(asc(autoApprovePolicies.createdAt));
  }

  return {
    listActive: async (companyId: string): Promise<AutoApprovePolicy[]> =>
      (await listActiveRows(companyId)).map(toPolicy),

    create: async (
      companyId: string,
      input: {
        agentId: string;
        approvalType: string;
        maxBand: RiskBand;
        maxSpendCents: number;
        requireNoSecrets: boolean;
        createdByUserId?: string | null;
      },
    ): Promise<AutoApprovePolicyRow> => {
      return db
        .insert(autoApprovePolicies)
        .values({
          companyId,
          agentId: input.agentId,
          approvalType: input.approvalType,
          maxBand: input.maxBand,
          maxSpendCents: input.maxSpendCents,
          requireNoSecrets: input.requireNoSecrets,
          createdByUserId: input.createdByUserId ?? null,
          updatedByUserId: input.createdByUserId ?? null,
        })
        .returning()
        .then((r) => r[0]!);
    },

    update: async (
      companyId: string,
      id: string,
      patch: Partial<{
        maxBand: RiskBand;
        maxSpendCents: number;
        requireNoSecrets: boolean;
        isActive: boolean;
        updatedByUserId: string | null;
      }>,
    ): Promise<AutoApprovePolicyRow | null> => {
      return db
        .update(autoApprovePolicies)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(autoApprovePolicies.companyId, companyId), eq(autoApprovePolicies.id, id)))
        .returning()
        .then((r) => r[0] ?? null);
    },

    deactivate: async (companyId: string, id: string): Promise<void> => {
      await db
        .update(autoApprovePolicies)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(autoApprovePolicies.companyId, companyId), eq(autoApprovePolicies.id, id)));
    },

    async evaluateForApproval(approvalId: string): Promise<{ matched: AutoApprovePolicy | null; reasons: string[] }> {
      const approval = await db.select().from(approvals).where(eq(approvals.id, approvalId)).then((r) => r[0] ?? null);
      if (!approval) return { matched: null, reasons: ["approval not found"] };

      const riskRow = await db
        .select({ band: approvalRisk.band, reasons: approvalRisk.reasons })
        .from(approvalRisk)
        .where(eq(approvalRisk.approvalId, approvalId))
        .then((r) => r[0] ?? null);

      const policies = (await listActiveRows(approval.companyId)).map(toPolicy);
      return evaluateAutoApprove(
        {
          approval: {
            type: approval.type,
            requestedByAgentId: approval.requestedByAgentId ?? null,
            payload: approval.payload,
          },
          risk: riskRow ? { band: riskRow.band as RiskBand, reasons: riskRow.reasons ?? [] } : null,
          impliedSpendCents: impliedSpendFromApproval(approval.payload),
          hasSecretsOrSensitive: hasSensitiveBoundary({ type: approval.type, payload: approval.payload }),
        },
        policies,
      );
    },
  };
}
// [END: module]
