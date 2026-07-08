/**
 * FILE: ui/src/lib/groupBy.ts
 * ABOUT: groupBy.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - groupBy.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: groupBy.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/groupBy.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }
  return result;
}
// [END: module]
