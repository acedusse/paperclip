/**
 * FILE: cli/src/client/command-label.ts
 * ABOUT: command-label.ts (client module).
 *
 * SECTIONS:
 *   [TAG: module] - command-label.ts (client module).
 */
// ==========================================
// [META: module]
// INTENT: command-label.ts (client module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/client/command-label.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function buildCliCommandLabel(): string {
  const args = process.argv.slice(2);
  return args.length > 0 ? `paperclipai ${args.join(" ")}` : "paperclipai";
}
// [END: module]
