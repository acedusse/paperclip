/**
 * FILE: packages/adapters/cursor-local/src/shared/trust.ts
 * ABOUT: trust.ts (shared module).
 *
 * SECTIONS:
 *   [TAG: module] - trust.ts (shared module).
 */
// ==========================================
// [META: module]
// INTENT: trust.ts (shared module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapters/cursor-local/src/shared/trust.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function hasCursorTrustBypassArg(args: readonly string[]): boolean {
  return args.some(
    (arg) =>
      arg === "--trust" ||
      arg === "--yolo" ||
      arg === "-f" ||
      arg.startsWith("--trust="),
  );
}
// [END: module]
