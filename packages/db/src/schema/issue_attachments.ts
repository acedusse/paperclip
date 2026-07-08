/**
 * FILE: packages/db/src/schema/issue_attachments.ts
 * ABOUT: issue_attachments.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - issue_attachments.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: issue_attachments.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/issue_attachments.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { assets } from "./assets.js";
import { issueComments } from "./issue_comments.js";

export const issueAttachments = pgTable(
  "issue_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    issueCommentId: uuid("issue_comment_id").references(() => issueComments.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIssueIdx: index("issue_attachments_company_issue_idx").on(table.companyId, table.issueId),
    issueCommentIdx: index("issue_attachments_issue_comment_idx").on(table.issueCommentId),
    assetUq: uniqueIndex("issue_attachments_asset_uq").on(table.assetId),
  }),
);
// [END: module]
