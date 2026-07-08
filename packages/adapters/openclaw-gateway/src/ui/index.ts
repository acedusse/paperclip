/**
 * FILE: packages/adapters/openclaw-gateway/src/ui/index.ts
 * ABOUT: index.ts (ui module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (ui module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (ui module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapters/openclaw-gateway/src/ui/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export { parseOpenClawGatewayStdoutLine } from "./parse-stdout.js";
export { buildOpenClawGatewayConfig } from "./build-config.js";
// [END: module]
