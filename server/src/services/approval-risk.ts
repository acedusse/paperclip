/**
 * FILE: server/src/services/approval-risk.ts
 * ABOUT: approval-risk.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - approval-risk.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: approval-risk.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/approval-risk.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { approvals, approvalRisk, autoApprovePolicies, runChangesets } from "@paperclipai/db";

export type RiskBand = "low" | "medium" | "high" | "critical";
export const RISK_BAND_ORDER: RiskBand[] = ["low", "medium", "high", "critical"];

export function bandRank(b: RiskBand): number {
  return RISK_BAND_ORDER.indexOf(b);
}

export type RiskContext = {
  approval: { type: string; payload: Record<string, unknown> };
  agentTrustStage?: "trusted" | "probation" | "untrusted" | "unknown";
  impliedSpendCents?: number;
  changeset?: { additions: number; deletions: number; filesChanged: number } | null;
};

type Signal = { name: string; evaluate(ctx: RiskContext): { points: number; reason: string } | null };

const SENSITIVE_PAYLOAD_KEYS = ["secretRef", "secret", "externalUrl", "webhookUrl", "budgetMonthlyCents", "budgetCents"];
const SENSITIVE_TYPES = ["hire_agent", "secret_grant", "external_send", "budget_change"];

function detectSensitiveBoundaries(a: RiskContext["approval"]): string[] {
  const flags: string[] = [];
  if (SENSITIVE_TYPES.includes(a.type)) flags.push(`type:${a.type}`);
  for (const k of SENSITIVE_PAYLOAD_KEYS) if (k in a.payload) flags.push(`payload:${k}`);
  return flags;
}

export function hasSensitiveBoundary(a: { type: string; payload: Record<string, unknown> }): boolean {
  return detectSensitiveBoundaries(a).length > 0;
}

export function impliedSpendFromApproval(payload: Record<string, unknown>): number {
  return typeof payload?.budgetMonthlyCents === "number" ? (payload.budgetMonthlyCents as number) : 0;
}

const SIGNALS: Signal[] = [
  {
    name: "trust-stage",
    evaluate: (ctx) => {
      const stage = ctx.agentTrustStage ?? "unknown";
      const pts = { trusted: 0, probation: 25, untrusted: 40, unknown: 40 }[stage];
      return pts > 0 ? { points: pts, reason: `agent trust stage: ${stage}` } : null;
    },
  },
  {
    name: "implied-spend",
    evaluate: (ctx) => {
      const c = ctx.impliedSpendCents ?? 0;
      const pts = c >= 5000 ? 45 : c >= 500 ? 30 : c >= 50 ? 15 : 0;
      return pts > 0 ? { points: pts, reason: `implied spend ~$${(c / 100).toFixed(2)}` } : null;
    },
  },
  {
    name: "sensitive-boundary",
    evaluate: (ctx) => {
      const flags = detectSensitiveBoundaries(ctx.approval);
      return flags.length ? { points: 40, reason: `sensitive boundary: ${flags.join(", ")}` } : null;
    },
  },
  {
    name: "diff-size",
    evaluate: (ctx) => {
      const total = (ctx.changeset?.additions ?? 0) + (ctx.changeset?.deletions ?? 0);
      const pts = Math.min(30, Math.round(total / 20));
      return pts > 0 ? { points: pts, reason: `${total} changed lines across ${ctx.changeset?.filesChanged ?? 0} files` } : null;
    },
  },
];

function bandFor(score: number): RiskBand {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export function riskScore(ctx: RiskContext): { score: number; band: RiskBand; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  for (const s of SIGNALS) {
    const r = s.evaluate(ctx);
    if (r) {
      score += r.points;
      reasons.push(r.reason);
    }
  }
  score = Math.min(100, score);
  return { score, band: bandFor(score), reasons };
}

export function approvalRiskService(db: Db) {
  return {
    getSnapshot: (approvalId: string) =>
      db
        .select()
        .from(approvalRisk)
        .where(eq(approvalRisk.approvalId, approvalId))
        .then((r) => r[0] ?? null),

    async computeAndPersist(approvalId: string) {
      const approval = await db
        .select()
        .from(approvals)
        .where(eq(approvals.id, approvalId))
        .then((r) => r[0] ?? null);
      if (!approval) throw new Error(`approval ${approvalId} not found`);

      // diff-size signal: pull the linked run's changeset if the payload references one.
      const runId = typeof approval.payload?.runId === "string" ? (approval.payload.runId as string) : null;
      const changeset = runId
        ? await db
            .select({ s: runChangesets.summaryStats })
            .from(runChangesets)
            .where(eq(runChangesets.heartbeatRunId, runId))
            .then((r) => r[0]?.s ?? null)
        : null;

      const impliedSpendCents = impliedSpendFromApproval(approval.payload);

      // Combo-05 Phase 2a: a human allowlisting an agent for auto-approve IS the trust decision.
      // Treat an allowlisted agent as `trusted` so its clean work can reach the `low` band; other
      // signals (spend, secrets, diff size) still climb above `low` and keep it in the human queue.
      // Idea 009 not yet built; non-allowlisted agents degrade to lowest trust (`unknown`).
      const agentId = approval.requestedByAgentId ?? null;
      const isAllowlisted = agentId
        ? await db
            .select({ id: autoApprovePolicies.id })
            .from(autoApprovePolicies)
            .where(
              and(
                eq(autoApprovePolicies.companyId, approval.companyId),
                eq(autoApprovePolicies.agentId, agentId),
                eq(autoApprovePolicies.isActive, true),
              ),
            )
            .limit(1)
            .then((r) => r.length > 0)
        : false;

      const result = riskScore({
        approval: { type: approval.type, payload: approval.payload },
        agentTrustStage: isAllowlisted ? "trusted" : "unknown",
        impliedSpendCents,
        changeset,
      });

      await db
        .insert(approvalRisk)
        .values({
          approvalId,
          companyId: approval.companyId,
          score: result.score,
          band: result.band,
          reasons: result.reasons,
          computedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: approvalRisk.approvalId,
          set: { score: result.score, band: result.band, reasons: result.reasons, computedAt: new Date() },
        });
      return result;
    },
  };
}
// [END: module]
