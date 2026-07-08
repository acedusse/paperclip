/**
 * FILE: packages/adapter-utils/src/sandbox-shell.ts
 * ABOUT: sandbox-shell.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - sandbox-shell.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: sandbox-shell.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapter-utils/src/sandbox-shell.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function preferredShellForSandbox(shellCommand: string | null | undefined): "bash" | "sh" {
  return shellCommand === "bash" ? "bash" : "sh";
}

export function shellCommandArgs(script: string): string[] {
  return ["-c", script];
}
// [END: module]
