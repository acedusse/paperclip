/**
 * FILE: cli/src/adapters/http/format-event.ts
 * ABOUT: format-event.ts (http module).
 *
 * SECTIONS:
 *   [TAG: module] - format-event.ts (http module).
 */
// ==========================================
// [META: module]
// INTENT: format-event.ts (http module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/adapters/http/format-event.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function printHttpStdoutEvent(raw: string, _debug: boolean): void {
  const line = raw.trim();
  if (line) console.log(line);
}
// [END: module]
