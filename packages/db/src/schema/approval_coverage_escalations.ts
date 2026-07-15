/**
 * FILE: packages/db/src/schema/approval_coverage_escalations.ts
 * ABOUT: approval_coverage_escalations.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - approval_coverage_escalations.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: approval_coverage_escalations.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/approval_coverage_escalations.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { approvals } from "./approvals.js";

export const approvalCoverageEscalations = pgTable("approval_coverage_escalations", {
  approvalId: uuid("approval_id").primaryKey().references(() => approvals.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  backupUserId: text("backup_user_id").notNull(),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ApprovalCoverageEscalationRow = typeof approvalCoverageEscalations.$inferSelect;
// [END: module]
