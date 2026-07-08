/**
 * FILE: cli/src/adapters/http/index.ts
 * ABOUT: index.ts (http module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (http module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (http module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/adapters/http/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { CLIAdapterModule } from "@paperclipai/adapter-utils";
import { printHttpStdoutEvent } from "./format-event.js";

export const httpCLIAdapter: CLIAdapterModule = {
  type: "http",
  formatStdoutEvent: printHttpStdoutEvent,
};
// [END: module]
