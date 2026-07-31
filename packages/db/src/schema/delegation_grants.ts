/**
 * FILE: packages/db/src/schema/delegation_grants.ts
 * ABOUT: delegation_grants.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - delegation_grants.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: delegation_grants.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/delegation_grants.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, text, integer, jsonb, timestamp, index, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const delegationGrants = pgTable(
  "delegation_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    grantorUserId: text("grantor_user_id").notNull(),
    delegateUserId: text("delegate_user_id").notNull(),
    approvalTypes: jsonb("approval_types").notNull().default([]).$type<string[]>(),
    maxBand: text("max_band").notNull(),
    maxSpendCents: integer("max_spend_cents"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyDelegateIdx: index("delegation_grants_company_delegate_idx").on(table.companyId, table.delegateUserId),
  }),
);
export type DelegationGrantRow = typeof delegationGrants.$inferSelect;
// [END: module]
