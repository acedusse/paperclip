/**
 * FILE: packages/db/src/schema/labels.ts
 * ABOUT: labels.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - labels.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: labels.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/labels.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("labels_company_idx").on(table.companyId),
    companyNameIdx: uniqueIndex("labels_company_name_idx").on(table.companyId, table.name),
  }),
);
// [END: module]
