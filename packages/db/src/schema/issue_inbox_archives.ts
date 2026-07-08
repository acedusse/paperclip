/**
 * FILE: packages/db/src/schema/issue_inbox_archives.ts
 * ABOUT: issue_inbox_archives.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - issue_inbox_archives.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: issue_inbox_archives.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/issue_inbox_archives.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const issueInboxArchives = pgTable(
  "issue_inbox_archives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id),
    userId: text("user_id").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIssueIdx: index("issue_inbox_archives_company_issue_idx").on(table.companyId, table.issueId),
    companyUserIdx: index("issue_inbox_archives_company_user_idx").on(table.companyId, table.userId),
    companyIssueUserUnique: uniqueIndex("issue_inbox_archives_company_issue_user_idx").on(
      table.companyId,
      table.issueId,
      table.userId,
    ),
  }),
);
// [END: module]
