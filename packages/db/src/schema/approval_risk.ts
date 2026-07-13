/**
 * FILE: packages/db/src/schema/approval_risk.ts
 * ABOUT: approval_risk.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - approval_risk.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: approval_risk.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/approval_risk.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { approvals } from "./approvals.js";

export const approvalRisk = pgTable("approval_risk", {
  approvalId: uuid("approval_id")
    .primaryKey()
    .references(() => approvals.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  band: text("band").notNull(), // low | medium | high | critical
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});
// [END: module]
