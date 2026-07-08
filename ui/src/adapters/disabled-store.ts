/**
 * FILE: ui/src/adapters/disabled-store.ts
 * ABOUT: disabled-store.ts (adapters module).
 *
 * SECTIONS:
 *   [TAG: module] - disabled-store.ts (adapters module).
 */
// ==========================================
// [META: module]
// INTENT: disabled-store.ts (adapters module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/adapters/disabled-store.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
/**
 * Client-side store for disabled adapter types.
 *
 * Hydrated from the server's GET /api/adapters response.
 * Provides synchronous reads so module-level constants can filter against it.
 * Falls back to "nothing disabled" before the first hydration.
 *
 * Usage in components:
 *   useQuery + adaptersApi.list() populates the store automatically.
 *
 * Usage in non-React code:
 *   import { isAdapterTypeHidden } from "@/adapters/disabled-store";
 */

let disabledTypes = new Set<string>();

/** Check if an adapter type is hidden from menus (sync read). */
export function isAdapterTypeHidden(type: string): boolean {
  return disabledTypes.has(type);
}

/** Get all hidden adapter types (sync read). */
export function getHiddenAdapterTypes(): Set<string> {
  return disabledTypes;
}

/**
 * Hydrate the store from a server response.
 * Called by components that fetch the adapters list.
 */
export function setDisabledAdapterTypes(types: string[]): void {
  disabledTypes = new Set(types);
}
// [END: module]
