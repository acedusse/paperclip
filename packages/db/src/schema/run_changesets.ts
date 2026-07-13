/**
 * FILE: packages/db/src/schema/run_changesets.ts
 * ABOUT: run_changesets.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - run_changesets.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: run_changesets.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/run_changesets.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export type RunChangesetFile = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  oldPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
  truncated: boolean;
  diff?: string; // unified diff text; omitted when binary or truncated
};

export type RunChangesetCommand = {
  command: string;
  status: string;
  exitCode: number | null;
};

export const runChangesets = pgTable(
  "run_changesets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    heartbeatRunId: uuid("heartbeat_run_id")
      .notNull()
      .unique() // one changeset per run — Task 3's onConflictDoNothing targets this
      .references(() => heartbeatRuns.id, { onDelete: "cascade" }),
    baseRef: text("base_ref"),
    headRef: text("head_ref"),
    files: jsonb("files").$type<RunChangesetFile[]>().notNull().default([]),
    commands: jsonb("commands").$type<RunChangesetCommand[]>().notNull().default([]),
    summaryStats: jsonb("summary_stats")
      .$type<{ filesChanged: number; additions: number; deletions: number }>()
      .notNull(),
    warning: text("warning"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
// [END: module]
