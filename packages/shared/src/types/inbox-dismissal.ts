/**
 * FILE: packages/shared/src/types/inbox-dismissal.ts
 * ABOUT: inbox-dismissal.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - inbox-dismissal.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: inbox-dismissal.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/inbox-dismissal.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export interface InboxDismissal {
  id: string;
  companyId: string;
  userId: string;
  itemKey: string;
  dismissedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
// [END: module]
