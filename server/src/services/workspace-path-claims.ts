/**
 * FILE: server/src/services/workspace-path-claims.ts
 * ABOUT: workspace-path-claims.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - workspace-path-claims.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: workspace-path-claims.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/workspace-path-claims.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { workspacePathClaims } from "@paperclipai/db";
import { and, eq, isNotNull, lte, ne } from "drizzle-orm";
import { normalizeClaimPath } from "./workspace-path-overlap.js";

export const DEFAULT_CLAIM_TTL_MS = 1_800_000;

export type WorkspacePathClaim = typeof workspacePathClaims.$inferSelect;

export interface AcquireClaimInput {
  companyId: string;
  executionWorkspaceId: string;
  heartbeatRunId: string;
  agentId: string | null;
  path: string;
  ttlMs?: number;
  now?: Date;
}

export function workspacePathClaimService(db: Db) {
  return {
    async acquireClaim(input: AcquireClaimInput): Promise<WorkspacePathClaim> {
      const now = input.now ?? new Date();
      const ttlMs = input.ttlMs ?? DEFAULT_CLAIM_TTL_MS;
      const row = await db
        .insert(workspacePathClaims)
        .values({
          id: randomUUID(),
          companyId: input.companyId,
          executionWorkspaceId: input.executionWorkspaceId,
          heartbeatRunId: input.heartbeatRunId,
          agentId: input.agentId,
          path: normalizeClaimPath(input.path),
          status: "active",
          acquiredAt: now,
          expiresAt: new Date(now.getTime() + ttlMs),
        })
        .returning()
        .then((rows) => rows[0]!);
      return row;
    },

    async releaseClaimsForRun(
      heartbeatRunId: string,
      status: "released" | "expired" | "failed" = "released",
      now: Date = new Date(),
    ): Promise<number> {
      const rows = await db
        .update(workspacePathClaims)
        .set({ status, releasedAt: now, updatedAt: now })
        .where(and(
          eq(workspacePathClaims.heartbeatRunId, heartbeatRunId),
          eq(workspacePathClaims.status, "active"),
        ))
        .returning();
      return rows.length;
    },

    async listActiveClaimsOnWorkspace(
      executionWorkspaceId: string,
      excludeRunId?: string,
    ): Promise<WorkspacePathClaim[]> {
      const conditions = [
        eq(workspacePathClaims.executionWorkspaceId, executionWorkspaceId),
        eq(workspacePathClaims.status, "active"),
      ];
      if (excludeRunId) {
        conditions.push(ne(workspacePathClaims.heartbeatRunId, excludeRunId));
      }
      return db
        .select()
        .from(workspacePathClaims)
        .where(and(...conditions))
        .orderBy(workspacePathClaims.acquiredAt);
    },

    async findExpiredClaims(now: Date): Promise<Array<{ id: string }>> {
      return db
        .select({ id: workspacePathClaims.id })
        .from(workspacePathClaims)
        .where(and(
          eq(workspacePathClaims.status, "active"),
          isNotNull(workspacePathClaims.expiresAt),
          lte(workspacePathClaims.expiresAt, now),
        ));
    },

    async expireClaim(id: string, now: Date = new Date()): Promise<void> {
      await db
        .update(workspacePathClaims)
        .set({ status: "expired", releasedAt: now, updatedAt: now })
        .where(and(
          eq(workspacePathClaims.id, id),
          eq(workspacePathClaims.status, "active"),
        ));
    },
  };
}
// [END: module]
