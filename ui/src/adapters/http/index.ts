/**
 * FILE: ui/src/adapters/http/index.ts
 * ABOUT: index.ts (http module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (http module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (http module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/adapters/http/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { UIAdapterModule } from "../types";
import { parseHttpStdoutLine } from "./parse-stdout";
import { HttpConfigFields } from "./config-fields";
import { buildHttpConfig } from "./build-config";

export const httpUIAdapter: UIAdapterModule = {
  type: "http",
  label: "HTTP Webhook",
  parseStdoutLine: parseHttpStdoutLine,
  ConfigFields: HttpConfigFields,
  buildAdapterConfig: buildHttpConfig,
};
// [END: module]
