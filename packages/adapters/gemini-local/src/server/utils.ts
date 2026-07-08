/**
 * FILE: packages/adapters/gemini-local/src/server/utils.ts
 * ABOUT: utils.ts (server module).
 *
 * SECTIONS:
 *   [TAG: module] - utils.ts (server module).
 */
// ==========================================
// [META: module]
// INTENT: utils.ts (server module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapters/gemini-local/src/server/utils.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function firstNonEmptyLine(text: string): string {
    return (
        text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find(Boolean) ?? ""
    );
}
// [END: module]
