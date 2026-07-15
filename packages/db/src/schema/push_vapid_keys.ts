/**
 * FILE: packages/db/src/schema/push_vapid_keys.ts
 * ABOUT: push_vapid_keys.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - push_vapid_keys.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: push_vapid_keys.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/push_vapid_keys.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const pushVapidKeys = pgTable(
  "push_vapid_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    singleton: text("singleton").notNull().default("default"),
    publicKey: text("public_key").notNull(),
    privateKey: text("private_key").notNull(),
    subject: text("subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    singletonUniqueIdx: uniqueIndex("push_vapid_keys_singleton_unique_idx").on(table.singleton),
  }),
);
export type PushVapidKeyRow = typeof pushVapidKeys.$inferSelect;
// [END: module]
