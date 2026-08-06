/**
 * FILE: ui/src/api/telegram.ts
 * ABOUT: telegram.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - client for the Telegram channel setup + chat-linking endpoints.
 */
// ==========================================
// [META: module]
// INTENT: Wrap the board-facing half of the Telegram channel. The bot token is write-only server-side,
//   so no read type here carries one.
// PSEUDOCODE: 1. Declare the config/binding shapes. 2. Map each endpoint onto the shared api client.
// JSON_FLOW: {"file": "ui/src/api/telegram.ts", "imports": "./client", "exports": "telegramApi, TelegramConfig, TelegramBinding"}
// ==========================================
// [START: module]
import { api } from "./client";

export type TelegramConfig =
  | { configured: false }
  | {
      configured: true;
      botUsername: string | null;
      enabled: boolean;
      publicBaseUrl?: string | null;
      webhookPath: string;
      updatedAt?: string;
    };

export type TelegramBinding = {
  id: string;
  userId: string;
  chatLabel: string | null;
  linkedAt: string | null;
  lastUsedAt: string | null;
};

export type TelegramLinkCode = { code: string; expiresAt: string; deepLink: string | null };

export const telegramApi = {
  getConfig: (companyId: string) => api.get<TelegramConfig>(`/companies/${companyId}/telegram/config`),
  putConfig: (
    companyId: string,
    body: { botToken: string; botUsername?: string | null; publicBaseUrl?: string | null; enabled?: boolean },
  ) =>
    api.put<{ ok: true; webhookPath: string; webhookSecret: string }>(
      `/companies/${companyId}/telegram/config`,
      body,
    ),
  removeConfig: (companyId: string) => api.delete<{ ok: true }>(`/companies/${companyId}/telegram/config`),
  createLinkCode: (companyId: string, body: { chatLabel?: string } = {}) =>
    api.post<TelegramLinkCode>(`/companies/${companyId}/telegram/link-codes`, body),
  listBindings: (companyId: string) => api.get<TelegramBinding[]>(`/companies/${companyId}/telegram/bindings`),
  revokeBinding: (companyId: string, id: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/telegram/bindings/${id}`),
};
// [END: module]
