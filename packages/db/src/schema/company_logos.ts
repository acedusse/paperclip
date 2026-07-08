/**
 * FILE: packages/db/src/schema/company_logos.ts
 * ABOUT: company_logos.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - company_logos.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: company_logos.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/company_logos.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { assets } from "./assets.js";

export const companyLogos = pgTable(
  "company_logos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUq: uniqueIndex("company_logos_company_uq").on(table.companyId),
    assetUq: uniqueIndex("company_logos_asset_uq").on(table.assetId),
  }),
);
// [END: module]
