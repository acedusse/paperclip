/**
 * FILE: packages/db/src/schema/workspace_path_claims.ts
 * ABOUT: workspace_path_claims.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - workspace_path_claims.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: workspace_path_claims.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/workspace_path_claims.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { executionWorkspaces } from "./execution_workspaces.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { agents } from "./agents.js";

export const workspacePathClaims = pgTable(
  "workspace_path_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    executionWorkspaceId: uuid("execution_workspace_id").notNull().references(() => executionWorkspaces.id, { onDelete: "cascade" }),
    heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    path: text("path").notNull(),
    status: text("status").notNull().default("active"),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyWorkspaceStatusIdx: index("workspace_path_claims_company_workspace_status_idx").on(
      table.companyId, table.executionWorkspaceId, table.status,
    ),
    heartbeatRunIdx: index("workspace_path_claims_heartbeat_run_idx").on(table.heartbeatRunId),
    companyExpiresIdx: index("workspace_path_claims_company_expires_idx").on(table.companyId, table.expiresAt),
  }),
);
// [END: module]
