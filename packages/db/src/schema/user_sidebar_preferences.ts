/**
 * FILE: packages/db/src/schema/user_sidebar_preferences.ts
 * ABOUT: user_sidebar_preferences.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - user_sidebar_preferences.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: user_sidebar_preferences.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/user_sidebar_preferences.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

export const userSidebarPreferences = pgTable(
  "user_sidebar_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    companyOrder: jsonb("company_order").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userUq: uniqueIndex("user_sidebar_preferences_user_uq").on(table.userId),
  }),
);
// [END: module]
