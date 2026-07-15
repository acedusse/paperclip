/**
 * FILE: packages/db/src/schema/auto_approve_policies.ts
 * ABOUT: auto_approve_policies.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - auto_approve_policies.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: Per-company allowlist of (agent x approval-type) rules whose low-risk items may be auto-approved.
// PSEUDOCODE: 1. Load dependencies. 2. Define table. 3. Export table + inferred type.
// JSON_FLOW: {"file": "packages/db/src/schema/auto_approve_policies.ts", "imports": "companies, agents", "exports": "autoApprovePolicies, AutoApprovePolicyRow"}
// ==========================================
// [START: module]
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const autoApprovePolicies = pgTable(
  "auto_approve_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    approvalType: text("approval_type").notNull(),
    maxBand: text("max_band").notNull(), // low | medium | high | critical — must be ≤ AUTO_DECISION_MAX_BAND
    maxSpendCents: integer("max_spend_cents").notNull().default(0),
    requireNoSecrets: boolean("require_no_secrets").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: text("created_by_user_id"),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyActiveIdx: index("auto_approve_policies_company_active_idx").on(table.companyId, table.isActive),
    companyAgentTypeActiveUniqueIdx: uniqueIndex("auto_approve_policies_company_agent_type_active_unique_idx").on(
      table.companyId,
      table.agentId,
      table.approvalType,
      table.isActive,
    ),
  }),
);

export type AutoApprovePolicyRow = typeof autoApprovePolicies.$inferSelect;
// [END: module]
