/**
 * FILE: cli/src/adapters/process/index.ts
 * ABOUT: index.ts (process module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (process module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (process module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/adapters/process/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { CLIAdapterModule } from "@paperclipai/adapter-utils";
import { printProcessStdoutEvent } from "./format-event.js";

export const processCLIAdapter: CLIAdapterModule = {
  type: "process",
  formatStdoutEvent: printProcessStdoutEvent,
};
// [END: module]
