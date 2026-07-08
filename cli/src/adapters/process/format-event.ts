/**
 * FILE: cli/src/adapters/process/format-event.ts
 * ABOUT: format-event.ts (process module).
 *
 * SECTIONS:
 *   [TAG: module] - format-event.ts (process module).
 */
// ==========================================
// [META: module]
// INTENT: format-event.ts (process module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/adapters/process/format-event.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function printProcessStdoutEvent(raw: string, _debug: boolean): void {
  const line = raw.trim();
  if (line) console.log(line);
}
// [END: module]
