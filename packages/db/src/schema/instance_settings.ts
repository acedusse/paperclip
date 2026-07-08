/**
 * FILE: packages/db/src/schema/instance_settings.ts
 * ABOUT: instance_settings.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - instance_settings.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: instance_settings.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/instance_settings.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { environments } from "./environments.js";

export const instanceSettings = pgTable(
  "instance_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    singletonKey: text("singleton_key").notNull().default("default"),
    defaultEnvironmentId: uuid("default_environment_id").references(() => environments.id, { onDelete: "set null" }),
    general: jsonb("general").$type<Record<string, unknown>>().notNull().default({}),
    experimental: jsonb("experimental").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    singletonKeyIdx: uniqueIndex("instance_settings_singleton_key_idx").on(table.singletonKey),
  }),
);
// [END: module]
