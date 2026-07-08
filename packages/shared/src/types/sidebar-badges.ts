/**
 * FILE: packages/shared/src/types/sidebar-badges.ts
 * ABOUT: sidebar-badges.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - sidebar-badges.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: sidebar-badges.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/sidebar-badges.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export interface SidebarBadges {
  inbox: number;
  approvals: number;
  failedRuns: number;
  joinRequests: number;
}
// [END: module]
