/**
 * FILE: ui/src/api/push.ts
 * ABOUT: push.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - push.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: push.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/push.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { api } from "./client";

export const pushApi = {
  vapidPublicKey: () => api.get<{ publicKey: string }>(`/push/vapid-public-key`),
  subscribe: (
    companyId: string,
    body: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string },
  ) => api.post<{ ok: true }>(`/companies/${companyId}/push/subscriptions`, body),
  unsubscribe: (companyId: string, endpoint: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/push/subscriptions`, { endpoint }),
};
// [END: module]
