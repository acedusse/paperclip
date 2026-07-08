/**
 * FILE: server/src/middleware/index.ts
 * ABOUT: index.ts (middleware module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (middleware module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (middleware module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/middleware/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export { logger, httpLogger } from "./logger.js";
export { errorHandler } from "./error-handler.js";
export { validate } from "./validate.js";
// [END: module]
