/**
 * FILE: packages/db/src/schema/bounded_agent_approvers.ts
 * ABOUT: bounded_agent_approvers.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - bounded_agent_approvers.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: bounded_agent_approvers.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/bounded_agent_approvers.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, text, integer, jsonb, timestamp, index, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const boundedAgentApprovers = pgTable(
  "bounded_agent_approvers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    grantorUserId: text("grantor_user_id").notNull(),
    delegateAgentId: text("delegate_agent_id").notNull(),
    approvalTypes: jsonb("approval_types").notNull().default([]).$type<string[]>(),
    maxBand: text("max_band").notNull(),
    maxSpendCents: integer("max_spend_cents"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id"),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyDelegateIdx: index("bounded_agent_approvers_company_agent_idx").on(table.companyId, table.delegateAgentId),
  }),
);
export type BoundedAgentApproverRow = typeof boundedAgentApprovers.$inferSelect;
// [END: module]
