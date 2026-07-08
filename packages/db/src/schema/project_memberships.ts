/**
 * FILE: packages/db/src/schema/project_memberships.ts
 * ABOUT: project_memberships.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - project_memberships.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: project_memberships.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/project_memberships.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const projectMemberships = pgTable(
  "project_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    state: text("state").notNull().default("joined"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUserIdx: index("project_memberships_company_user_idx").on(table.companyId, table.userId),
    projectIdx: index("project_memberships_project_idx").on(table.projectId),
    companyUserProjectUq: uniqueIndex("project_memberships_company_user_project_uq").on(
      table.companyId,
      table.userId,
      table.projectId,
    ),
  }),
);
// [END: module]
