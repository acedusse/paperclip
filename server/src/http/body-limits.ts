/**
 * FILE: server/src/http/body-limits.ts
 * ABOUT: body-limits.ts (http module).
 *
 * SECTIONS:
 *   [TAG: module] - body-limits.ts (http module).
 */
// ==========================================
// [META: module]
// INTENT: body-limits.ts (http module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/http/body-limits.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export const DEFAULT_JSON_BODY_LIMIT = "10mb";
export const PORTABLE_JSON_BODY_LIMIT = "64mb";
export const PORTABLE_JSON_BODY_LIMIT_BYTES = 64 * 1024 * 1024;
// [END: module]
