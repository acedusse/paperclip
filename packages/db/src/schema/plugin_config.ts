/**
 * FILE: packages/db/src/schema/plugin_config.ts
 * ABOUT: plugin_config.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - plugin_config.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: plugin_config.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/plugin_config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { plugins } from "./plugins.js";

/**
 * `plugin_config` table — stores operator-provided instance configuration
 * for each plugin (one row per plugin, enforced by a unique index on
 * `plugin_id`).
 *
 * The `config_json` column holds the values that the operator enters in the
 * plugin settings UI. These values are validated at runtime against the
 * plugin's `instanceConfigSchema` from the manifest.
 *
 * @see PLUGIN_SPEC.md §21.3
 */
export const pluginConfig = pgTable(
  "plugin_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pluginId: uuid("plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull().default({}),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pluginIdIdx: uniqueIndex("plugin_config_plugin_id_idx").on(table.pluginId),
  }),
);
// [END: module]
