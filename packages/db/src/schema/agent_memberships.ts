/**
 * FILE: packages/db/src/schema/agent_memberships.ts
 * ABOUT: agent_memberships.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - agent_memberships.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: agent_memberships.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/agent_memberships.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

export const agentMemberships = pgTable(
  "agent_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    state: text("state").notNull().default("joined"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUserIdx: index("agent_memberships_company_user_idx").on(table.companyId, table.userId),
    agentIdx: index("agent_memberships_agent_idx").on(table.agentId),
    companyUserAgentUq: uniqueIndex("agent_memberships_company_user_agent_uq").on(
      table.companyId,
      table.userId,
      table.agentId,
    ),
  }),
);
// [END: module]
