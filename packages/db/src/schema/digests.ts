/**
 * FILE: packages/db/src/schema/digests.ts
 * ABOUT: digests.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - digests.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: Scheduled digest records for companies, containing payload data.
// PSEUDOCODE: 1. Load dependencies. 2. Define table. 3. Export table + inferred type.
// JSON_FLOW: {"file": "packages/db/src/schema/digests.ts", "imports": "companies", "exports": "digests, DigestRow"}
// ==========================================
// [START: module]
import { index, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const digests = pgTable(
  "digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyGeneratedIdx: index("digests_company_generated_idx").on(table.companyId, table.generatedAt),
  }),
);

export type DigestRow = typeof digests.$inferSelect;
// [END: module]
