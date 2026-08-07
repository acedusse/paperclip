/**
 * FILE: packages/db/src/schema/telegram_chat_bindings.ts
 * ABOUT: telegram_chat_bindings.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - binding between a Telegram chat and one authorised Paperclip user.
 */
// ==========================================
// [META: module]
// INTENT: Bind a Telegram chat to exactly one Paperclip user in one company, so a tapped Approve button
//   can be attributed to a real operator. A row starts life as an unclaimed one-time link code
//   (chat_id null) and becomes a live binding when that code is redeemed from the chat.
// PSEUDOCODE: 1. Define telegram_chat_bindings. 2. Unique per (company, chat) and per link code.
//   3. Export the row type.
// JSON_FLOW: {"file": "packages/db/src/schema/telegram_chat_bindings.ts", "imports": "drizzle-orm/pg-core, ./companies.js", "exports": "telegramChatBindings, TelegramChatBindingRow"}
// ==========================================
// [START: module]
import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const telegramChatBindings = pgTable(
  "telegram_chat_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    // Null until the one-time code is redeemed from a chat. Postgres treats nulls as distinct, so
    // many unredeemed codes can coexist under the company-scoped unique index below.
    chatId: text("chat_id"),
    // The Telegram user who redeemed the code. Authority rests on this, not on the chat: a bound
    // group chat is visible to everyone in it, so a tapped button is only honoured when the tapper
    // is this user. Null on bindings created before migration 0125 — those fail closed and must
    // re-link.
    telegramUserId: text("telegram_user_id"),
    chatLabel: text("chat_label"),
    linkCode: text("link_code"),
    linkCodeExpiresAt: timestamp("link_code_expires_at", { withTimezone: true }),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One *live* binding per chat per company: revoked rows stay for audit and drop out of the index.
    companyChatUniqueIdx: uniqueIndex("telegram_chat_bindings_company_chat_unique_idx")
      .on(table.companyId, table.chatId)
      .where(sql`${table.revokedAt} IS NULL`),
    linkCodeUniqueIdx: uniqueIndex("telegram_chat_bindings_link_code_unique_idx").on(table.linkCode),
    companyIdx: index("telegram_chat_bindings_company_idx").on(table.companyId),
    chatIdx: index("telegram_chat_bindings_chat_idx").on(table.chatId),
    // Mini App sessions will resolve a binding from initData's user id with no chat in hand.
    telegramUserIdx: index("telegram_chat_bindings_telegram_user_idx").on(table.telegramUserId),
  }),
);
export type TelegramChatBindingRow = typeof telegramChatBindings.$inferSelect;
// [END: module]
