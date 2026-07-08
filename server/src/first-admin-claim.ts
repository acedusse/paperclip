/**
 * FILE: server/src/first-admin-claim.ts
 * ABOUT: first-admin-claim.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - first-admin-claim.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: first-admin-claim.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/first-admin-claim.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { instanceUserRoles } from "@paperclipai/db";

type FirstAdminTransaction = Pick<Db, "execute" | "select" | "insert" | "update">;

export type FirstAdminClaimResult<T = unknown> =
  | {
      status: "claimed";
      userId: string;
      value: T | null;
    }
  | {
      status: "already_claimed";
      existingUserId: string | null;
      value: null;
    };

export async function claimFirstInstanceAdmin<T = unknown>(
  db: Db,
  input: {
    userId: string;
    onClaim?: (tx: FirstAdminTransaction) => Promise<T>;
  },
): Promise<FirstAdminClaimResult<T>> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table ${instanceUserRoles} in share row exclusive mode`);

    const existingAdmin = await tx
      .select({ userId: instanceUserRoles.userId })
      .from(instanceUserRoles)
      .where(eq(instanceUserRoles.role, "instance_admin"))
      .then((rows) => rows[0] ?? null);

    if (existingAdmin) {
      return {
        status: "already_claimed" as const,
        existingUserId: existingAdmin.userId ?? null,
        value: null,
      };
    }

    await tx.insert(instanceUserRoles).values({
      userId: input.userId,
      role: "instance_admin",
    });

    const value = input.onClaim ? await input.onClaim(tx) : null;
    return {
      status: "claimed" as const,
      userId: input.userId,
      value,
    };
  });
}
// [END: module]
