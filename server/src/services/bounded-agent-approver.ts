/**
 * FILE: server/src/services/bounded-agent-approver.ts
 * ABOUT: bounded-agent-approver.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - bounded-agent-approver.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: CRUD for human-authorized bounded manager-agent approver grants.
// PSEUDOCODE: 1. create. 2. get. 3. list (optionally active-at). 4. revoke.
// JSON_FLOW: {"file": "server/src/services/bounded-agent-approver.ts", "imports": "@paperclipai/db", "exports": "boundedAgentApproverService"}
// ==========================================
// [START: module]
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { boundedAgentApprovers, type BoundedAgentApproverRow } from "@paperclipai/db";
import type { RiskBand } from "./approval-risk.js";

export function boundedAgentApproverService(db: Db) {
  return {
    async createGrant(
      companyId: string,
      grantorUserId: string,
      input: {
        delegateAgentId: string;
        approvalTypes: string[];
        maxBand: RiskBand;
        maxSpendCents: number | null;
        validFrom?: Date;
        validUntil: Date;
      },
    ): Promise<BoundedAgentApproverRow> {
      const [row] = await db
        .insert(boundedAgentApprovers)
        .values({
          companyId,
          grantorUserId,
          delegateAgentId: input.delegateAgentId,
          approvalTypes: input.approvalTypes,
          maxBand: input.maxBand,
          maxSpendCents: input.maxSpendCents,
          validFrom: input.validFrom ?? new Date(),
          validUntil: input.validUntil,
          createdByUserId: grantorUserId,
          updatedByUserId: grantorUserId,
        })
        .returning();
      return row!;
    },

    async getGrant(id: string): Promise<BoundedAgentApproverRow | null> {
      const [row] = await db.select().from(boundedAgentApprovers).where(eq(boundedAgentApprovers.id, id)).limit(1);
      return row ?? null;
    },

    async listGrants(companyId: string, opts: { activeAt?: Date } = {}): Promise<BoundedAgentApproverRow[]> {
      const rows = await db
        .select()
        .from(boundedAgentApprovers)
        .where(eq(boundedAgentApprovers.companyId, companyId))
        .orderBy(desc(boundedAgentApprovers.createdAt));
      if (!opts.activeAt) return rows;
      const at = opts.activeAt;
      return rows.filter((g) => g.revokedAt === null && g.validFrom <= at && g.validUntil > at);
    },

    async revokeGrant(id: string, at: Date): Promise<BoundedAgentApproverRow | null> {
      const [row] = await db
        .update(boundedAgentApprovers)
        .set({ revokedAt: at, updatedAt: new Date() })
        .where(and(eq(boundedAgentApprovers.id, id), isNull(boundedAgentApprovers.revokedAt)))
        .returning();
      return row ?? null;
    },
  };
}
// [END: module]
