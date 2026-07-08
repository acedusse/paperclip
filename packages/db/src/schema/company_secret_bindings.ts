/**
 * FILE: packages/db/src/schema/company_secret_bindings.ts
 * ABOUT: company_secret_bindings.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - company_secret_bindings.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: company_secret_bindings.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/company_secret_bindings.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySecrets } from "./company_secrets.js";

export const companySecretBindings = pgTable(
  "company_secret_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    secretId: uuid("secret_id").notNull().references(() => companySecrets.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    configPath: text("config_path").notNull(),
    versionSelector: text("version_selector").notNull().default("latest"),
    required: boolean("required").notNull().default(true),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("company_secret_bindings_company_idx").on(table.companyId),
    secretIdx: index("company_secret_bindings_secret_idx").on(table.secretId),
    targetIdx: index("company_secret_bindings_target_idx").on(table.companyId, table.targetType, table.targetId),
    targetPathUq: uniqueIndex("company_secret_bindings_target_path_uq").on(
      table.companyId,
      table.targetType,
      table.targetId,
      table.configPath,
    ),
  }),
);
// [END: module]
