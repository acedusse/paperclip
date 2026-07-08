/**
 * FILE: packages/db/src/schema/assets.ts
 * ABOUT: assets.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - assets.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: assets.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/assets.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    provider: text("provider").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    originalFilename: text("original_filename"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("assets_company_created_idx").on(table.companyId, table.createdAt),
    companyProviderIdx: index("assets_company_provider_idx").on(table.companyId, table.provider),
    companyObjectKeyUq: uniqueIndex("assets_company_object_key_uq").on(table.companyId, table.objectKey),
  }),
);
// [END: module]
