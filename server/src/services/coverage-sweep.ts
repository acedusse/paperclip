/**
 * FILE: server/src/services/coverage-sweep.ts
 * ABOUT: coverage-sweep.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - coverage-sweep.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: Sweep pending approvals for companies with coverage enabled; escalate any past their
//   risk band's SLA to the configured backup user, once per approval (idempotent marker row).
// PSEUDOCODE: 1. Load enabled coverage configs. 2. For each, find pending approvals with no
//   escalation marker whose SLA deadline has passed. 3. Insert an idempotent marker per approval.
//   4. Best-effort notify the backup user through registered delivery channels.
// JSON_FLOW: {"file": "server/src/services/coverage-sweep.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { approvalCoverageEscalations, approvalRisk, approvals, companyCoverageConfig } from "@paperclipai/db";
import type { RiskBand } from "./approval-risk.js";
import { deliverThroughChannels, type NotificationPayload } from "./notification-delivery.js";
import { logger } from "../middleware/logger.js";

/** Pure: pick the SLA minutes threshold for a risk band from a company's coverage config. */
export function slaMinutesForBand(
  cfg: { slaCriticalMinutes: number; slaHighMinutes: number; slaMediumMinutes: number; slaLowMinutes: number },
  band: RiskBand,
): number {
  switch (band) {
    case "critical":
      return cfg.slaCriticalMinutes;
    case "high":
      return cfg.slaHighMinutes;
    case "medium":
      return cfg.slaMediumMinutes;
    default:
      return cfg.slaLowMinutes;
  }
}

export function coverageSweepService(db: Db) {
  return {
    async sweep(now: Date): Promise<{ escalated: string[] }> {
      const escalated: string[] = [];
      const configs = await db
        .select()
        .from(companyCoverageConfig)
        .where(eq(companyCoverageConfig.enabled, true));

      for (const cfg of configs) {
        if (!cfg.backupUserId) continue;
        const backupUserId = cfg.backupUserId;
        try {
          // Pending approvals for this company with no escalation marker yet, joined to their risk band.
          const rows = await db
            .select({
              id: approvals.id,
              createdAt: approvals.createdAt,
              band: approvalRisk.band,
            })
            .from(approvals)
            .leftJoin(approvalRisk, eq(approvalRisk.approvalId, approvals.id))
            .leftJoin(approvalCoverageEscalations, eq(approvalCoverageEscalations.approvalId, approvals.id))
            .where(
              and(
                eq(approvals.companyId, cfg.companyId),
                eq(approvals.status, "pending"),
                isNull(approvalCoverageEscalations.approvalId),
              ),
            );

          const due = rows.filter((r) => {
            const band = (r.band as RiskBand) ?? "low";
            const deadline = new Date(r.createdAt.getTime() + slaMinutesForBand(cfg, band) * 60_000);
            return now > deadline;
          });
          if (due.length === 0) continue;

          const escalatedForCompany: string[] = [];
          for (const r of due) {
            // Idempotent marker; ON CONFLICT guards against concurrent ticks re-escalating.
            const inserted = await db
              .insert(approvalCoverageEscalations)
              .values({ approvalId: r.id, companyId: cfg.companyId, backupUserId, escalatedAt: now })
              .onConflictDoNothing()
              .returning();
            if (inserted.length > 0) {
              escalated.push(r.id);
              escalatedForCompany.push(r.id);
            }
          }
          if (escalatedForCompany.length === 0) continue;

          const count = escalatedForCompany.length;
          const payload: NotificationPayload = {
            kind: "coverage.escalation",
            title: "Approvals past SLA need a decision",
            body: `${count} approval${count === 1 ? "" : "s"} in your queue passed the response deadline — you're the backup.`,
            link: "/approvals/triage",
            push: {
              title: "Approvals past SLA",
              body: `${count} approval${count === 1 ? "" : "s"} awaiting a decision`,
              url: "/approvals/triage",
              tag: "coverage-escalation",
              band: "high",
            },
          };
          // Best-effort: deliverThroughChannels already swallows per-channel throws, and any
          // failure here must not stop the sweep from processing other companies.
          await deliverThroughChannels({ companyId: cfg.companyId, userId: backupUserId }, payload);
        } catch (err) {
          logger.warn({ err, companyId: cfg.companyId }, "coverage sweep failed for company");
        }
      }
      return { escalated };
    },
  };
}
// [END: module]
