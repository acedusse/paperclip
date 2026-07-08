/**
 * FILE: server/src/services/inbox-dismissals.ts
 * ABOUT: inbox-dismissals.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - inbox-dismissals.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: inbox-dismissals.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/inbox-dismissals.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { inboxDismissals } from "@paperclipai/db";

export function inboxDismissalService(db: Db) {
  return {
    list: async (companyId: string, userId: string) =>
      db
        .select()
        .from(inboxDismissals)
        .where(and(eq(inboxDismissals.companyId, companyId), eq(inboxDismissals.userId, userId)))
        .orderBy(desc(inboxDismissals.updatedAt)),

    dismiss: async (
      companyId: string,
      userId: string,
      itemKey: string,
      dismissedAt: Date = new Date(),
    ) => {
      const now = new Date();
      const [row] = await db
        .insert(inboxDismissals)
        .values({
          companyId,
          userId,
          itemKey,
          dismissedAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [inboxDismissals.companyId, inboxDismissals.userId, inboxDismissals.itemKey],
          set: {
            dismissedAt,
            updatedAt: now,
          },
        })
        .returning();
      return row;
    },
  };
}
// [END: module]
