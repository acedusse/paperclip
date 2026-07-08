/**
 * FILE: server/src/services/assets.ts
 * ABOUT: assets.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - assets.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: assets.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/assets.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { assets } from "@paperclipai/db";

export function assetService(db: Db) {
  return {
    create: (companyId: string, data: Omit<typeof assets.$inferInsert, "companyId">) =>
      db
        .insert(assets)
        .values({ ...data, companyId })
        .returning()
        .then((rows) => rows[0]),

    getById: (id: string) =>
      db
        .select()
        .from(assets)
        .where(eq(assets.id, id))
        .then((rows) => rows[0] ?? null),
  };
}
// [END: module]
