/**
 * FILE: packages/db/src/schema/companies.ts
 * ABOUT: companies.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - companies.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: companies.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/companies.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, integer, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    pauseReason: text("pause_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    issuePrefix: text("issue_prefix").notNull().default("PAP"),
    issueCounter: integer("issue_counter").notNull().default(0),
    budgetMonthlyCents: integer("budget_monthly_cents").notNull().default(0),
    spentMonthlyCents: integer("spent_monthly_cents").notNull().default(0),
    maxConcurrentRuns: integer("max_concurrent_runs"),
    // Combo-01 Phase 2a per-run ceilings (company override; null = unset).
    maxRunWallClockMs: integer("max_run_wall_clock_ms"),
    maxRunCostCents: integer("max_run_cost_cents"),
    // Combo-01 Phase 2b per-run turn ceiling (company override; null = unset).
    maxRunTurns: integer("max_run_turns"),
    // Combo-01 Phase 2c: fleet execution state. running = normal; draining =
    // refuse new run starts; halted = refuse new + in-flight wound down.
    runExecutionState: text("run_execution_state").notNull().default("running"),
    attachmentMaxBytes: integer("attachment_max_bytes")
      .notNull()
      .default(10 * 1024 * 1024),
    requireBoardApprovalForNewAgents: boolean("require_board_approval_for_new_agents")
      .notNull()
      .default(false),
    feedbackDataSharingEnabled: boolean("feedback_data_sharing_enabled")
      .notNull()
      .default(false),
    feedbackDataSharingConsentAt: timestamp("feedback_data_sharing_consent_at", { withTimezone: true }),
    feedbackDataSharingConsentByUserId: text("feedback_data_sharing_consent_by_user_id"),
    feedbackDataSharingTermsVersion: text("feedback_data_sharing_terms_version"),
    brandColor: text("brand_color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issuePrefixUniqueIdx: uniqueIndex("companies_issue_prefix_idx").on(table.issuePrefix),
  }),
);
// [END: module]
