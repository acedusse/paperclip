/**
 * FILE: ui/src/adapters/cursor-cloud/index.ts
 * ABOUT: index.ts (cursor-cloud module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (cursor-cloud module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (cursor-cloud module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/adapters/cursor-cloud/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { UIAdapterModule } from "../types";
import { SchemaConfigFields } from "../schema-config-fields";
import {
  buildCursorCloudConfig,
  parseCursorCloudStdoutLine,
} from "@paperclipai/adapter-cursor-cloud/ui";

export const cursorCloudUIAdapter: UIAdapterModule = {
  type: "cursor_cloud",
  label: "Cursor Cloud",
  parseStdoutLine: parseCursorCloudStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildCursorCloudConfig,
};
// [END: module]
