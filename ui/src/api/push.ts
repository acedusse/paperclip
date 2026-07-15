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

export type PushPrefs = {
  minBand: "high" | "critical";
  quietStart: string | null;
  quietEnd: string | null;
  timezone: string | null;
};
export type PushDevice = {
  id: string;
  label: string | null;
  userAgent: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  endpointTail: string;
};

export const pushApi = {
  vapidPublicKey: () => api.get<{ publicKey: string }>(`/push/vapid-public-key`),
  subscribe: (
    companyId: string,
    body: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string; label?: string },
  ) => api.post<{ ok: true }>(`/companies/${companyId}/push/subscriptions`, body),
  unsubscribe: (companyId: string, endpoint: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/push/subscriptions`, { endpoint }),
  getPrefs: (companyId: string) => api.get<PushPrefs>(`/companies/${companyId}/push/prefs`),
  putPrefs: (companyId: string, body: PushPrefs) =>
    api.put<{ ok: true }>(`/companies/${companyId}/push/prefs`, body),
  listDevices: (companyId: string) => api.get<PushDevice[]>(`/companies/${companyId}/push/subscriptions`),
  renameDevice: (companyId: string, id: string, label: string) =>
    api.patch<{ ok: true }>(`/companies/${companyId}/push/subscriptions/${id}`, { label }),
  removeDevice: (companyId: string, id: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/push/subscriptions/${id}`),
};
// [END: module]
