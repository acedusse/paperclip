/**
 * FILE: server/src/lib/objects.ts
 * ABOUT: objects.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - objects.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: objects.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/lib/objects.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
// [END: module]
