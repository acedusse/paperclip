/**
 * FILE: ui/src/adapters/openclaw-gateway/index.ts
 * ABOUT: index.ts (openclaw-gateway module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (openclaw-gateway module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (openclaw-gateway module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/adapters/openclaw-gateway/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { UIAdapterModule } from "../types";
import { parseOpenClawGatewayStdoutLine } from "@paperclipai/adapter-openclaw-gateway/ui";
import { buildOpenClawGatewayConfig } from "@paperclipai/adapter-openclaw-gateway/ui";
import { OpenClawGatewayConfigFields } from "./config-fields";

export const openClawGatewayUIAdapter: UIAdapterModule = {
  type: "openclaw_gateway",
  label: "OpenClaw Gateway",
  parseStdoutLine: parseOpenClawGatewayStdoutLine,
  ConfigFields: OpenClawGatewayConfigFields,
  buildAdapterConfig: buildOpenClawGatewayConfig,
};
// [END: module]
