/**
 * FILE: server/src/services/digest.ts
 * ABOUT: digest.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - digest.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: Compose digest signals + narration into a persisted digest through
// the delivery pipeline, and sweep active companies on an interval.
// PSEUDOCODE: 1. generateForCompany: since = last digest's periodEnd or
// company.createdAt; collect signals (degrade to empty on error); narrate;
// deliver through every registered channel (isolated try/catch); return the
// freshly persisted latest digest. 2. sweep: iterate active companies,
// skipping ones whose latest digest is newer than minIntervalHours, isolating
// per-company failures.
// JSON_FLOW: {"file": "server/src/services/digest.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { desc, eq } from "drizzle-orm";
import type { Db, DigestRow } from "@paperclipai/db";
import { companies, digests } from "@paperclipai/db";
import { collectDigestSignals } from "./digest-signals.js";
import { narrateDigest } from "./digest-narration.js";
import { getChannels } from "./notification-delivery.js";
import { logger } from "../middleware/logger.js";

export const DIGEST_MIN_INTERVAL_HOURS = 24;

export function digestService(db: Db) {
  const latest = (companyId: string): Promise<DigestRow | null> =>
    db
      .select()
      .from(digests)
      .where(eq(digests.companyId, companyId))
      .orderBy(desc(digests.generatedAt))
      .limit(1)
      .then((r) => r[0] ?? null);

  async function generateForCompany(companyId: string): Promise<DigestRow | null> {
    const company = await db.select().from(companies).where(eq(companies.id, companyId)).then((r) => r[0] ?? null);
    if (!company) return null;

    const last = await latest(companyId);
    const since = last?.periodEnd ?? company.createdAt;
    const now = new Date();

    const signals = await collectDigestSignals(db, companyId, since).catch((err) => {
      logger.warn({ err, companyId }, "digest signal collection failed; using empty signals");
      return {
        openApprovals: { total: 0, byBand: { low: 0, medium: 0, high: 0, critical: 0 }, top: [] },
        autoApprovedSince: 0,
        staleRuns: { total: 0, top: [] },
      };
    });
    const payload = narrateDigest(signals);

    for (const channel of getChannels()) {
      try {
        await channel.deliver(
          { companyId },
          { kind: "digest", title: payload.headline, digest: { payload, periodStart: since, periodEnd: now } },
        );
      } catch (err) {
        logger.warn({ err, companyId, channel: channel.name }, "digest delivery channel failed");
      }
    }

    return latest(companyId);
  }

  return {
    latest,
    generateForCompany,
    list: (companyId: string, limit = 20): Promise<DigestRow[]> =>
      db
        .select()
        .from(digests)
        .where(eq(digests.companyId, companyId))
        .orderBy(desc(digests.generatedAt))
        .limit(limit),

    async sweep(now: Date, opts: { minIntervalHours?: number } = {}): Promise<{ generated: string[] }> {
      const minHours = opts.minIntervalHours ?? DIGEST_MIN_INTERVAL_HOURS;
      const active = await db.select({ id: companies.id }).from(companies).where(eq(companies.status, "active"));
      const generated: string[] = [];
      for (const c of active) {
        try {
          const last = await latest(c.id);
          if (last && now.getTime() - last.generatedAt.getTime() < minHours * 60 * 60 * 1000) continue;
          const d = await generateForCompany(c.id);
          if (d) generated.push(c.id);
        } catch (err) {
          logger.warn({ err, companyId: c.id }, "digest sweep failed for company");
        }
      }
      return { generated };
    },
  };
}
// [END: module]
