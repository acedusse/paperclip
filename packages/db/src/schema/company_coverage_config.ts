/**
 * FILE: packages/db/src/schema/company_coverage_config.ts
 * ABOUT: company_coverage_config.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - company_coverage_config.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: company_coverage_config.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/company_coverage_config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, text, integer, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const companyCoverageConfig = pgTable("company_coverage_config", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  backupUserId: text("backup_user_id"),
  slaCriticalMinutes: integer("sla_critical_minutes").notNull().default(60),
  slaHighMinutes: integer("sla_high_minutes").notNull().default(240),
  slaMediumMinutes: integer("sla_medium_minutes").notNull().default(1440),
  slaLowMinutes: integer("sla_low_minutes").notNull().default(4320),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type CompanyCoverageConfigRow = typeof companyCoverageConfig.$inferSelect;
// [END: module]
