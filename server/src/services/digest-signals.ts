/**
 * FILE: server/src/services/digest-signals.ts
 * ABOUT: digest-signals.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - digest-signals.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: Collect "what needs the human" signals for a company's scheduled
// digest: open approvals (risk-sorted), auto-approved decisions since a
// timestamp, and stale (long-running, not-recently-updated) heartbeat runs.
// PSEUDOCODE: 1. Load open approvals via Phase-1 triage service. 2. Count
// approval.decision audit rows with method=auto_policy since `since`. 3. Find
// live-status heartbeat runs not updated within STALE_RUN_HOURS. 4. Shape and
// return DigestSignals.
// JSON_FLOW: {"file": "server/src/services/digest-signals.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog, heartbeatRuns } from "@paperclipai/db";
import { approvalTriageService } from "./approval-triage.js";
import type { RiskBand } from "./approval-risk.js";

const LIVE_RUN_STATUSES = ["queued", "running", "scheduled_retry"];
const STALE_RUN_HOURS = 6;
const BANDS: RiskBand[] = ["low", "medium", "high", "critical"];

export type DigestSignals = {
  openApprovals: {
    total: number;
    byBand: Record<RiskBand, number>;
    top: { id: string; type: string; band: RiskBand; score: number }[];
  };
  autoApprovedSince: number;
  staleRuns: {
    total: number;
    top: { runId: string; agentId: string | null; status: string; staleForMinutes: number }[];
  };
};

export async function collectDigestSignals(db: Db, companyId: string, since: Date): Promise<DigestSignals> {
  const now = Date.now();

  // Open approvals — reuse the Phase-1 triage service (already risk-sorted).
  const { items } = await approvalTriageService(db).listTriage(companyId);
  const byBand: Record<RiskBand, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const it of items) {
    const band = (it.risk.band as RiskBand) ?? "low";
    if (BANDS.includes(band)) byBand[band] += 1;
  }
  const openApprovals = {
    total: items.length,
    byBand,
    top: items.slice(0, 3).map((it) => ({
      id: it.id,
      type: it.type,
      band: (it.risk.band as RiskBand) ?? "low",
      score: it.risk.score ?? 0,
    })),
  };

  // Auto-approved since `since` — approval.decision audit rows with method=auto_policy.
  const autoRows = await db
    .select({ id: activityLog.id })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.companyId, companyId),
        eq(activityLog.action, "approval.decision"),
        sql`${activityLog.details} ->> 'method' = 'auto_policy'`,
        gte(activityLog.createdAt, since),
      ),
    );
  const autoApprovedSince = autoRows.length;

  // Stale runs — live-status runs not updated in > STALE_RUN_HOURS.
  const staleThreshold = new Date(now - STALE_RUN_HOURS * 60 * 60 * 1000);
  const staleRows = await db
    .select({
      id: heartbeatRuns.id,
      agentId: heartbeatRuns.agentId,
      status: heartbeatRuns.status,
      updatedAt: heartbeatRuns.updatedAt,
    })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, companyId),
        inArray(heartbeatRuns.status, LIVE_RUN_STATUSES),
        lt(heartbeatRuns.updatedAt, staleThreshold),
      ),
    );
  const staleSorted = staleRows
    .map((r) => ({
      runId: r.id,
      agentId: r.agentId,
      status: r.status,
      staleForMinutes: Math.floor((now - r.updatedAt.getTime()) / 60000),
    }))
    .sort((a, b) => b.staleForMinutes - a.staleForMinutes);

  return {
    openApprovals,
    autoApprovedSince,
    staleRuns: { total: staleSorted.length, top: staleSorted.slice(0, 3) },
  };
}
// [END: module]
