/**
 * FILE: cli/src/adapters/index.ts
 * ABOUT: index.ts (adapters module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (adapters module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (adapters module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/adapters/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export { getCLIAdapter } from "./registry.js";
export type { CLIAdapterModule } from "@paperclipai/adapter-utils";
// [END: module]
