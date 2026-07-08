/**
 * FILE: ui/src/adapters/hermes-local/index.ts
 * ABOUT: index.ts (hermes-local module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (hermes-local module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (hermes-local module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/adapters/hermes-local/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { UIAdapterModule } from "../types";
import { parseHermesStdoutLine } from "hermes-paperclip-adapter/ui";
import { buildHermesConfig } from "hermes-paperclip-adapter/ui";
import { SchemaConfigFields } from "../schema-config-fields";

export const hermesLocalUIAdapter: UIAdapterModule = {
  type: "hermes_local",
  label: "Hermes Agent",
  parseStdoutLine: parseHermesStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildHermesConfig,
};
// [END: module]
