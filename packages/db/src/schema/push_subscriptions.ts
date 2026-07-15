/**
 * FILE: packages/db/src/schema/push_subscriptions.ts
 * ABOUT: push_subscriptions.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - push_subscriptions.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: push_subscriptions.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/push_subscriptions.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => ({
    endpointUniqueIdx: uniqueIndex("push_subscriptions_endpoint_unique_idx").on(table.endpoint),
    companyIdx: index("push_subscriptions_company_idx").on(table.companyId),
  }),
);
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
// [END: module]
