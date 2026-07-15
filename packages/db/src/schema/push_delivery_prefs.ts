/**
 * FILE: packages/db/src/schema/push_delivery_prefs.ts
 * ABOUT: push_delivery_prefs.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - push_delivery_prefs.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: push_delivery_prefs.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/push_delivery_prefs.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const pushDeliveryPrefs = pgTable(
  "push_delivery_prefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    minBand: text("min_band").notNull().default("high"),
    quietStart: text("quiet_start"),
    quietEnd: text("quiet_end"),
    timezone: text("timezone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUserUniqueIdx: uniqueIndex("push_delivery_prefs_company_user_unique_idx").on(
      table.companyId,
      table.userId,
    ),
  }),
);
export type PushDeliveryPrefsRow = typeof pushDeliveryPrefs.$inferSelect;
// [END: module]
