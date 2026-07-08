/**
 * FILE: ui/src/adapters/grok-local/index.ts
 * ABOUT: index.ts (grok-local module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (grok-local module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (grok-local module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/adapters/grok-local/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { UIAdapterModule } from "../types";
import { createGrokStdoutParser, parseGrokStdoutLine } from "@paperclipai/adapter-grok-local/ui";
import { buildGrokLocalConfig } from "@paperclipai/adapter-grok-local/ui";
import { GrokLocalConfigFields } from "./config-fields";

export const grokLocalUIAdapter: UIAdapterModule = {
  type: "grok_local",
  label: "Grok Build (local)",
  parseStdoutLine: parseGrokStdoutLine,
  createStdoutParser: createGrokStdoutParser,
  ConfigFields: GrokLocalConfigFields,
  buildAdapterConfig: buildGrokLocalConfig,
};
// [END: module]
