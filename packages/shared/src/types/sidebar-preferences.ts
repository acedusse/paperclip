/**
 * FILE: packages/shared/src/types/sidebar-preferences.ts
 * ABOUT: sidebar-preferences.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - sidebar-preferences.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: sidebar-preferences.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/sidebar-preferences.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export interface SidebarOrderPreference {
  orderedIds: string[];
  updatedAt: Date | null;
}
// [END: module]
