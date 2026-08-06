/**
 * FILE: packages/db/src/schema/telegram_miniapp_sessions.ts
 * ABOUT: telegram_miniapp_sessions.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - short-lived board sessions minted from a verified Mini App initData.
 */
// ==========================================
// [META: module]
// INTENT: Hold a Mini App's bearer session as a hash, scoped to exactly one company, so a Telegram
//   webview can call the board API as its bound user without a password and without a long-lived key.
// PSEUDOCODE: 1. Define telegram_miniapp_sessions. 2. Unique on token_hash, indexed by binding.
//   3. Export the row type.
// JSON_FLOW: {"file": "packages/db/src/schema/telegram_miniapp_sessions.ts", "imports": "drizzle-orm/pg-core, ./companies.js, ./telegram_chat_bindings.js", "exports": "telegramMiniappSessions, TelegramMiniappSessionRow"}
// ==========================================
// [START: module]
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { telegramChatBindings } from "./telegram_chat_bindings.js";

export const telegramMiniappSessions = pgTable(
  "telegram_miniapp_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    // Kept so revoking a chat binding revokes every session it produced.
    bindingId: uuid("binding_id").references(() => telegramChatBindings.id, { onDelete: "set null" }),
    // The token itself is returned to the client once and never stored.
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashIdx: index("telegram_miniapp_sessions_token_hash_idx").on(table.tokenHash),
    bindingIdx: index("telegram_miniapp_sessions_binding_idx").on(table.bindingId),
  }),
);
export type TelegramMiniappSessionRow = typeof telegramMiniappSessions.$inferSelect;
// [END: module]
