/**
 * FILE: server/src/services/delegation.ts
 * ABOUT: delegation.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - delegation.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: delegation.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/delegation.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { delegationGrants, companyCoverageConfig, type DelegationGrantRow, type CompanyCoverageConfigRow } from "@paperclipai/db";
import type { RiskBand } from "./approval-risk.js";

export function delegationService(db: Db) {
  return {
    async createGrant(
      companyId: string,
      grantorUserId: string,
      input: {
        delegateUserId: string;
        approvalTypes: string[];
        maxBand: RiskBand;
        maxSpendCents: number | null;
        validFrom?: Date;
        validUntil: Date;
        source?: "manual" | "out_of_office";
      },
    ): Promise<DelegationGrantRow> {
      const [row] = await db
        .insert(delegationGrants)
        .values({
          companyId,
          grantorUserId,
          delegateUserId: input.delegateUserId,
          approvalTypes: input.approvalTypes,
          maxBand: input.maxBand,
          maxSpendCents: input.maxSpendCents,
          validFrom: input.validFrom ?? new Date(),
          validUntil: input.validUntil,
          source: input.source ?? "manual",
        })
        .returning();
      return row!;
    },

    async getGrant(id: string): Promise<DelegationGrantRow | null> {
      const [row] = await db.select().from(delegationGrants).where(eq(delegationGrants.id, id)).limit(1);
      return row ?? null;
    },

    async listGrants(companyId: string, opts: { activeAt?: Date } = {}): Promise<DelegationGrantRow[]> {
      const rows = await db
        .select()
        .from(delegationGrants)
        .where(eq(delegationGrants.companyId, companyId))
        .orderBy(desc(delegationGrants.createdAt));
      if (!opts.activeAt) return rows;
      const at = opts.activeAt;
      return rows.filter((g) => g.revokedAt === null && g.validFrom <= at && g.validUntil > at);
    },

    async revokeGrant(id: string, at: Date): Promise<DelegationGrantRow | null> {
      const [row] = await db
        .update(delegationGrants)
        .set({ revokedAt: at })
        .where(and(eq(delegationGrants.id, id), isNull(delegationGrants.revokedAt)))
        .returning();
      return row ?? null;
    },

    async getCoverageConfig(companyId: string): Promise<CompanyCoverageConfigRow | null> {
      const [row] = await db.select().from(companyCoverageConfig).where(eq(companyCoverageConfig.companyId, companyId)).limit(1);
      return row ?? null;
    },

    async upsertCoverageConfig(
      companyId: string,
      patch: Partial<Omit<CompanyCoverageConfigRow, "companyId" | "updatedAt">>,
    ): Promise<CompanyCoverageConfigRow> {
      const [row] = await db
        .insert(companyCoverageConfig)
        .values({ companyId, ...patch, updatedAt: new Date() })
        .onConflictDoUpdate({ target: companyCoverageConfig.companyId, set: { ...patch, updatedAt: new Date() } })
        .returning();
      return row!;
    },

    async setOutOfOffice(
      companyId: string,
      grantorUserId: string,
      input: { enabled: boolean; backupUserId?: string; maxBand?: RiskBand; until?: Date; now: Date },
    ): Promise<{ grant: DelegationGrantRow | null; revokedIds: string[] }> {
      // Revoke any active OOO presets this grantor already has.
      const active = await db
        .select()
        .from(delegationGrants)
        .where(
          and(
            eq(delegationGrants.companyId, companyId),
            eq(delegationGrants.grantorUserId, grantorUserId),
            eq(delegationGrants.source, "out_of_office"),
            isNull(delegationGrants.revokedAt),
            gt(delegationGrants.validUntil, input.now),
          ),
        );
      const revokedIds: string[] = [];
      for (const g of active) {
        await this.revokeGrant(g.id, input.now);
        revokedIds.push(g.id);
      }
      if (!input.enabled) return { grant: null, revokedIds };
      const grant = await this.createGrant(companyId, grantorUserId, {
        delegateUserId: input.backupUserId!,
        approvalTypes: [],
        maxBand: input.maxBand!,
        maxSpendCents: null,
        validFrom: input.now,
        validUntil: input.until!,
        source: "out_of_office",
      });
      return { grant, revokedIds };
    },
  };
}
// [END: module]
