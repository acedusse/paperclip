/**
 * FILE: packages/db/src/schema/company-breaker-state.ts
 * ABOUT: company-breaker-state.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - company-breaker-state.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: company-breaker-state.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/company-breaker-state.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { doublePrecision, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Combo-01 Phase 3a: persisted per-company breaker level. A row exists only for
// a company the breaker has evaluated. `since` drives the min-dwell hysteresis
// and survives crashes; the last_* columns are observability only.
export const companyBreakerState = pgTable("company_breaker_state", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  level: text("level").notNull().default("normal"),
  since: timestamp("since", { withTimezone: true }).notNull(),
  lastBurnRateCpm: doublePrecision("last_burn_rate_cpm"),
  lastTimeToLimitM: doublePrecision("last_time_to_limit_m"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
// [END: module]
