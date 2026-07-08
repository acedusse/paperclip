/**
 * FILE: packages/db/src/schema/invites.ts
 * ABOUT: invites.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - invites.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: invites.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/invites.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id),
    inviteType: text("invite_type").notNull().default("company_join"),
    tokenHash: text("token_hash").notNull(),
    allowedJoinTypes: text("allowed_join_types").notNull().default("both"),
    defaultsPayload: jsonb("defaults_payload").$type<Record<string, unknown> | null>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    invitedByUserId: text("invited_by_user_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUniqueIdx: uniqueIndex("invites_token_hash_unique_idx").on(table.tokenHash),
    companyInviteStateIdx: index("invites_company_invite_state_idx").on(
      table.companyId,
      table.inviteType,
      table.revokedAt,
      table.expiresAt,
    ),
  }),
);
// [END: module]
