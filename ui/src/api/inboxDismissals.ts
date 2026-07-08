/**
 * FILE: ui/src/api/inboxDismissals.ts
 * ABOUT: inboxDismissals.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - inboxDismissals.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: inboxDismissals.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/inboxDismissals.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { InboxDismissal } from "@paperclipai/shared";
import { api } from "./client";

export const inboxDismissalsApi = {
  list: (companyId: string) => api.get<InboxDismissal[]>(`/companies/${companyId}/inbox-dismissals`),
  dismiss: (companyId: string, itemKey: string) =>
    api.post<InboxDismissal>(`/companies/${companyId}/inbox-dismissals`, { itemKey }),
};
// [END: module]
