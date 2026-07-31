/**
 * FILE: packages/db/src/schema/stakeholder_shares.ts
 * ABOUT: stakeholder_shares.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - stakeholder_shares.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: stakeholder_shares.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/stakeholder_shares.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const stakeholderShares = pgTable(
  "stakeholder_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull().default("active"),
    // Every exposure toggle defaults OFF — a new share renders nothing until curated.
    showGoalProgress: boolean("show_goal_progress").notNull().default(false),
    showShippedWork: boolean("show_shipped_work").notNull().default(false),
    showNarrative: boolean("show_narrative").notNull().default(false),
    showActivityTimeline: boolean("show_activity_timeline").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenIdx: uniqueIndex("stakeholder_shares_token_idx").on(table.token),
    companyCreatedIdx: index("stakeholder_shares_company_created_idx").on(table.companyId, table.createdAt),
  }),
);

export type StakeholderShareRow = typeof stakeholderShares.$inferSelect;
// [END: module]
