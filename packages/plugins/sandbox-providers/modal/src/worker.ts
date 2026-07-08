/**
 * FILE: packages/plugins/sandbox-providers/modal/src/worker.ts
 * ABOUT: worker.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - worker.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: worker.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/sandbox-providers/modal/src/worker.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { runWorker } from "@paperclipai/plugin-sdk";
import plugin from "./plugin.js";

export default plugin;
runWorker(plugin, import.meta.url);
// [END: module]
