/**
 * FILE: packages/adapters/acpx-local/src/server/index.ts
 * ABOUT: index.ts (server module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (server module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (server module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapters/acpx-local/src/server/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export { execute, createAcpxLocalExecutor } from "./execute.js";
export { testEnvironment } from "./test.js";
export { getConfigSchema } from "./config-schema.js";
export { sessionCodec } from "./session-codec.js";
export { listAcpxSkills, syncAcpxSkills } from "./skills.js";
// [END: module]
