/**
 * FILE: packages/db/src/schema/agent_config_revisions.ts
 * ABOUT: agent_config_revisions.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - agent_config_revisions.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: agent_config_revisions.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/agent_config_revisions.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const agentConfigRevisions = pgTable(
  "agent_config_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    source: text("source").notNull().default("patch"),
    rolledBackFromRevisionId: uuid("rolled_back_from_revision_id"),
    changedKeys: jsonb("changed_keys").$type<string[]>().notNull().default([]),
    beforeConfig: jsonb("before_config").$type<Record<string, unknown>>().notNull(),
    afterConfig: jsonb("after_config").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyAgentCreatedIdx: index("agent_config_revisions_company_agent_created_idx").on(
      table.companyId,
      table.agentId,
      table.createdAt,
    ),
    agentCreatedIdx: index("agent_config_revisions_agent_created_idx").on(table.agentId, table.createdAt),
  }),
);
// [END: module]
