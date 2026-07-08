/**
 * FILE: ui/src/adapters/acpx-local/index.ts
 * ABOUT: index.ts (acpx-local module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (acpx-local module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (acpx-local module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/adapters/acpx-local/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { UIAdapterModule } from "../types";
import { parseAcpxStdoutLine, buildAcpxLocalConfig } from "@paperclipai/adapter-acpx-local/ui";
import { SchemaConfigFields } from "../schema-config-fields";

export const acpxLocalUIAdapter: UIAdapterModule = {
  type: "acpx_local",
  label: "ACPX (local)",
  parseStdoutLine: parseAcpxStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildAcpxLocalConfig,
};
// [END: module]
