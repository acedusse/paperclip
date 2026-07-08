/**
 * FILE: server/src/services/runtime-skill-selections.ts
 * ABOUT: runtime-skill-selections.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - runtime-skill-selections.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: runtime-skill-selections.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/runtime-skill-selections.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function skillVersionSelectionMap(entries: Array<{ key: string; versionId: string | null }>) {
  return new Map(entries.map((entry) => [entry.key, entry.versionId] as const));
}
// [END: module]
