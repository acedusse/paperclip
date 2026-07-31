/**
 * FILE: server/src/services/stakeholder-signals.ts
 * ABOUT: Gathers stakeholder-safe signals for Combo-05 Phase 4c share pages.
 *
 * SECTIONS:
 *   [TAG: module] - stakeholder-signals.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: Load ONLY the sections a share has explicitly enabled. A disabled
//         section is never queried, so a renderer bug alone cannot expose data
//         that was never fetched.
// PSEUDOCODE: 1. Always resolve company identity. 2. Per enabled toggle, run
//             exactly one narrow query. 3. Project to safe fields only.
// JSON_FLOW: {"file": "server/src/services/stakeholder-signals.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies, goals, issues } from "@paperclipai/db";
import type {
  StakeholderGoalProgress,
  StakeholderShippedItem,
  StakeholderSignals,
  StakeholderTimelineItem,
  StakeholderToggles,
} from "./stakeholder-share-policy.js";

/** Only company- and team-level goals are stakeholder-facing; agent/task goals are internal decomposition. */
const STAKEHOLDER_GOAL_LEVELS = ["company", "team"] as const;
const SHIPPED_WORK_LIMIT = 10;
const TIMELINE_LIMIT = 10;

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

export async function gatherStakeholderSignals(
  db: Db,
  companyId: string,
  toggles: StakeholderToggles,
): Promise<StakeholderSignals> {
  const companyRows = (await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)) as Array<{ name: string | null }>;

  const signals: StakeholderSignals = {
    companyName: companyRows[0]?.name ?? "This company",
  };

  if (toggles.showGoalProgress) {
    const rows = (await db
      .select({ title: goals.title, status: goals.status })
      .from(goals)
      .where(and(eq(goals.companyId, companyId), inArray(goals.level, [...STAKEHOLDER_GOAL_LEVELS])))
      .orderBy(desc(goals.updatedAt))) as Array<{ title: string; status: string }>;

    const byStatus: Record<string, number> = {};
    const safeGoals: StakeholderGoalProgress["goals"] = [];
    for (const row of rows) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      safeGoals.push({ title: row.title, status: row.status });
    }
    signals.goalProgress = { byStatus, goals: safeGoals };
  }

  if (toggles.showShippedWork) {
    const rows = (await db
      .select({ title: issues.title, updatedAt: issues.updatedAt })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.status, "done")))
      .orderBy(desc(issues.updatedAt))
      .limit(SHIPPED_WORK_LIMIT)) as Array<{ title: string; updatedAt: unknown }>;

    signals.shippedWork = rows.map<StakeholderShippedItem>((row) => ({
      title: row.title,
      completedAt: toIso(row.updatedAt),
    }));
  }

  if (toggles.showActivityTimeline) {
    const rows = (await db
      .select({ title: issues.title, status: issues.status, updatedAt: issues.updatedAt })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), inArray(issues.status, ["done", "in_review"])))
      .orderBy(desc(issues.updatedAt))
      .limit(TIMELINE_LIMIT)) as Array<{ title: string; status: string; updatedAt: unknown }>;

    signals.activityTimeline = rows.map<StakeholderTimelineItem>((row) => ({
      at: toIso(row.updatedAt),
      label: row.status === "done" ? `Completed: ${row.title}` : `In review: ${row.title}`,
    }));
  }

  return signals;
}
// [END: module]
