/**
 * FILE: server/src/services/stakeholder-share.ts
 * ABOUT: Combo-05 Phase 4c stakeholder transparency share service.
 *
 * SECTIONS:
 *   [TAG: module] - stakeholder-share.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: Manage tokenized, revocable, expiring read-only company shares and
//         resolve the public payload for a token.
// PSEUDOCODE: 1. CRUD over stakeholder_shares. 2. Public resolve = gate ->
//             gather enabled sections only -> project.
// JSON_FLOW: {"file": "server/src/services/stakeholder-share.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { stakeholderShares, type StakeholderShareRow } from "@paperclipai/db";
import {
  assertShareViewable,
  projectStakeholderPayload,
  type StakeholderPayload,
  type StakeholderToggles,
} from "./stakeholder-share-policy.js";
import { gatherStakeholderSignals } from "./stakeholder-signals.js";

/** 32 bytes of CSPRNG entropy, url-safe. */
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The list/read shape shown to operators. It deliberately omits `token` — the
 * full secret is returned only by create and rotate, the two moments the
 * operator actually needs to copy it.
 */
export type StakeholderShareSummary = {
  id: string;
  companyId: string;
  label: string;
  status: string;
  tokenTail: string;
  showGoalProgress: boolean;
  showShippedWork: boolean;
  showNarrative: boolean;
  showActivityTimeline: boolean;
  expiresAt: Date | null;
  revokedAt: Date | null;
  rotatedAt: Date | null;
  createdAt: Date;
};

export function toShareSummary(row: StakeholderShareRow): StakeholderShareSummary {
  return {
    id: row.id,
    companyId: row.companyId,
    label: row.label,
    status: row.status,
    tokenTail: row.token.slice(-6),
    showGoalProgress: row.showGoalProgress,
    showShippedWork: row.showShippedWork,
    showNarrative: row.showNarrative,
    showActivityTimeline: row.showActivityTimeline,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    rotatedAt: row.rotatedAt,
    createdAt: row.createdAt,
  };
}

function togglesOf(row: StakeholderShareRow): StakeholderToggles {
  return {
    showGoalProgress: row.showGoalProgress,
    showShippedWork: row.showShippedWork,
    showNarrative: row.showNarrative,
    showActivityTimeline: row.showActivityTimeline,
  };
}

export function stakeholderShareService(db: Db) {
  return {
    async create(
      companyId: string,
      input: {
        label: string;
        expiresAt?: Date | null;
        showGoalProgress?: boolean;
        showShippedWork?: boolean;
        showNarrative?: boolean;
        showActivityTimeline?: boolean;
      },
      createdByUserId: string | null,
    ): Promise<StakeholderShareRow> {
      const [row] = await db
        .insert(stakeholderShares)
        .values({
          companyId,
          token: generateShareToken(),
          label: input.label,
          status: "active",
          // Anything not explicitly opted into stays off.
          showGoalProgress: input.showGoalProgress ?? false,
          showShippedWork: input.showShippedWork ?? false,
          showNarrative: input.showNarrative ?? false,
          showActivityTimeline: input.showActivityTimeline ?? false,
          expiresAt: input.expiresAt ?? null,
          createdByUserId,
        })
        .returning();
      return row!;
    },

    async list(companyId: string): Promise<StakeholderShareRow[]> {
      return db
        .select()
        .from(stakeholderShares)
        .where(eq(stakeholderShares.companyId, companyId))
        .orderBy(desc(stakeholderShares.createdAt));
    },

    /** Id-only lookup used by routes to resolve the owning company before authorizing. */
    async getById(id: string): Promise<StakeholderShareRow | null> {
      const [row] = await db
        .select()
        .from(stakeholderShares)
        .where(eq(stakeholderShares.id, id))
        .limit(1);
      return row ?? null;
    },

    async get(companyId: string, id: string): Promise<StakeholderShareRow | null> {
      const [row] = await db
        .select()
        .from(stakeholderShares)
        .where(and(eq(stakeholderShares.id, id), eq(stakeholderShares.companyId, companyId)))
        .limit(1);
      return row ?? null;
    },

    async update(
      companyId: string,
      id: string,
      patch: {
        label?: string;
        expiresAt?: Date | null;
        showGoalProgress?: boolean;
        showShippedWork?: boolean;
        showNarrative?: boolean;
        showActivityTimeline?: boolean;
      },
    ): Promise<StakeholderShareRow | null> {
      const values: Record<string, unknown> = { updatedAt: new Date() };
      for (const key of [
        "label",
        "expiresAt",
        "showGoalProgress",
        "showShippedWork",
        "showNarrative",
        "showActivityTimeline",
      ] as const) {
        if (patch[key] !== undefined) values[key] = patch[key];
      }

      const [row] = await db
        .update(stakeholderShares)
        .set(values)
        .where(and(eq(stakeholderShares.id, id), eq(stakeholderShares.companyId, companyId)))
        .returning();
      return row ?? null;
    },

    async revoke(companyId: string, id: string, at: Date): Promise<StakeholderShareRow | null> {
      const [row] = await db
        .update(stakeholderShares)
        .set({ status: "revoked", revokedAt: at, updatedAt: at })
        .where(and(eq(stakeholderShares.id, id), eq(stakeholderShares.companyId, companyId)))
        .returning();
      return row ?? null;
    },

    /** Issues a fresh token; the previous one stops resolving in the same write. */
    async rotate(companyId: string, id: string, at: Date): Promise<StakeholderShareRow | null> {
      const [row] = await db
        .update(stakeholderShares)
        .set({ token: generateShareToken(), rotatedAt: at, updatedAt: at })
        .where(and(eq(stakeholderShares.id, id), eq(stakeholderShares.companyId, companyId)))
        .returning();
      return row ?? null;
    },

    /**
     * Public path. Returns null for unknown, revoked or expired tokens alike —
     * the caller turns every null into a 404 so the response cannot be used as
     * an existence oracle for share tokens.
     */
    async resolvePublic(token: string, now: Date): Promise<StakeholderPayload | null> {
      const [row] = await db
        .select()
        .from(stakeholderShares)
        .where(eq(stakeholderShares.token, token))
        .limit(1);
      if (!row) return null;

      const viewable = assertShareViewable({ status: row.status, expiresAt: row.expiresAt }, now);
      if (!viewable.ok) return null;

      const toggles = togglesOf(row);
      const signals = await gatherStakeholderSignals(db, row.companyId, toggles);
      return projectStakeholderPayload(toggles, signals);
    },
  };
}
// [END: module]
