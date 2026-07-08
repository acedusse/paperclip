/**
 * FILE: packages/db/src/schema/principal_permission_grants.ts
 * ABOUT: principal_permission_grants.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - principal_permission_grants.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: principal_permission_grants.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/principal_permission_grants.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const principalPermissionGrants = pgTable(
  "principal_permission_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    permissionKey: text("permission_key").notNull(),
    scope: jsonb("scope").$type<Record<string, unknown> | null>(),
    grantedByUserId: text("granted_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueGrantIdx: uniqueIndex("principal_permission_grants_unique_idx").on(
      table.companyId,
      table.principalType,
      table.principalId,
      table.permissionKey,
    ),
    companyPermissionIdx: index("principal_permission_grants_company_permission_idx").on(
      table.companyId,
      table.permissionKey,
    ),
  }),
);
// [END: module]
