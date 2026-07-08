/**
 * FILE: packages/db/src/schema/company_user_sidebar_preferences.ts
 * ABOUT: company_user_sidebar_preferences.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - company_user_sidebar_preferences.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: company_user_sidebar_preferences.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/company_user_sidebar_preferences.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const companyUserSidebarPreferences = pgTable(
  "company_user_sidebar_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    projectOrder: jsonb("project_order").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("company_user_sidebar_preferences_company_idx").on(table.companyId),
    userIdx: index("company_user_sidebar_preferences_user_idx").on(table.userId),
    companyUserUq: uniqueIndex("company_user_sidebar_preferences_company_user_uq").on(
      table.companyId,
      table.userId,
    ),
  }),
);
// [END: module]
