/**
 * FILE: packages/db/src/schema/telegram_bot_configs.ts
 * ABOUT: telegram_bot_configs.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - per-company Telegram bot credentials and delivery settings.
 */
// ==========================================
// [META: module]
// INTENT: Hold one Telegram bot registration per company: the bot token used to send, the shared
//   webhook secret Telegram echoes back on every delivery, and the base URL used to build deep links.
// PSEUDOCODE: 1. Define telegram_bot_configs keyed uniquely by company_id. 2. Export the row type.
// JSON_FLOW: {"file": "packages/db/src/schema/telegram_bot_configs.ts", "imports": "drizzle-orm/pg-core, ./companies.js", "exports": "telegramBotConfigs, TelegramBotConfigRow"}
// ==========================================
// [START: module]
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const telegramBotConfigs = pgTable(
  "telegram_bot_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    botToken: text("bot_token").notNull(),
    botUsername: text("bot_username"),
    webhookSecret: text("webhook_secret").notNull(),
    publicBaseUrl: text("public_base_url"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUniqueIdx: uniqueIndex("telegram_bot_configs_company_unique_idx").on(table.companyId),
  }),
);
export type TelegramBotConfigRow = typeof telegramBotConfigs.$inferSelect;
// [END: module]
