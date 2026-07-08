/**
 * FILE: packages/db/src/schema/board_api_keys.ts
 * ABOUT: board_api_keys.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - board_api_keys.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: board_api_keys.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/board_api_keys.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { authUsers } from "./auth.js";

export const boardApiKeys = pgTable(
  "board_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyHashIdx: uniqueIndex("board_api_keys_key_hash_idx").on(table.keyHash),
    userIdx: index("board_api_keys_user_idx").on(table.userId),
  }),
);
// [END: module]
