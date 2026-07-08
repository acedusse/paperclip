/**
 * FILE: server/src/adapters/builtin-adapter-types.ts
 * ABOUT: builtin-adapter-types.ts (adapters module).
 *
 * SECTIONS:
 *   [TAG: module] - builtin-adapter-types.ts (adapters module).
 */
// ==========================================
// [META: module]
// INTENT: builtin-adapter-types.ts (adapters module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/adapters/builtin-adapter-types.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
/**
 * Adapter types shipped with Paperclip. External plugins must not replace these.
 */
export const BUILTIN_ADAPTER_TYPES = new Set([
  "acpx_local",
  "claude_local",
  "codex_local",
  "cursor_cloud",
  "cursor",
  "gemini_local",
  "grok_local",
  "openclaw_gateway",
  "opencode_local",
  "pi_local",
  "hermes_local",
  "process",
  "http",
]);
// [END: module]
