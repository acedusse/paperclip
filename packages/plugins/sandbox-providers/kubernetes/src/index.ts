/**
 * FILE: packages/plugins/sandbox-providers/kubernetes/src/index.ts
 * ABOUT: index.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/sandbox-providers/kubernetes/src/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export { default as manifest } from "./manifest.js";
export { default as plugin } from "./plugin.js";
// [END: module]
