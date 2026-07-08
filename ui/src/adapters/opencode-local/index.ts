/**
 * FILE: ui/src/adapters/opencode-local/index.ts
 * ABOUT: index.ts (opencode-local module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (opencode-local module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (opencode-local module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/adapters/opencode-local/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { UIAdapterModule } from "../types";
import { parseOpenCodeStdoutLine } from "@paperclipai/adapter-opencode-local/ui";
import { OpenCodeLocalConfigFields } from "./config-fields";
import { buildOpenCodeLocalConfig } from "@paperclipai/adapter-opencode-local/ui";

export const openCodeLocalUIAdapter: UIAdapterModule = {
  type: "opencode_local",
  label: "OpenCode (local)",
  parseStdoutLine: parseOpenCodeStdoutLine,
  ConfigFields: OpenCodeLocalConfigFields,
  buildAdapterConfig: buildOpenCodeLocalConfig,
};
// [END: module]
