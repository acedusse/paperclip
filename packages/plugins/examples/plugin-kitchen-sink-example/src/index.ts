/**
 * FILE: packages/plugins/examples/plugin-kitchen-sink-example/src/index.ts
 * ABOUT: index.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/examples/plugin-kitchen-sink-example/src/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export { default as manifest } from "./manifest.js";
export { default as worker } from "./worker.js";
// [END: module]
