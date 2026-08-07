import { z } from "zod";

/**
 * Bot registration for one company. The token is write-only across the API: it goes in here and is
 * never read back out, so a board read cannot leak the ability to impersonate the bot.
 */
export const telegramConfigSchema = z.object({
  botToken: z.string().min(1).max(200),
  botUsername: z.string().min(1).max(64).nullable().optional(),
  publicBaseUrl: z.string().url().max(500).nullable().optional(),
  enabled: z.boolean().default(true),
});
export type TelegramConfigInput = z.infer<typeof telegramConfigSchema>;

export const telegramLinkCodeSchema = z.object({
  chatLabel: z.string().min(1).max(100).optional(),
  ttlMinutes: z.number().int().min(1).max(1440).optional(),
});
export type TelegramLinkCodeInput = z.infer<typeof telegramLinkCodeSchema>;
