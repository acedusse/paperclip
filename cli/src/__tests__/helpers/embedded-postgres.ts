/**
 * FILE: cli/src/__tests__/helpers/embedded-postgres.ts
 * ABOUT: embedded-postgres.ts (helpers module).
 *
 * SECTIONS:
 *   [TAG: module] - embedded-postgres.ts (helpers module).
 */
// ==========================================
// [META: module]
// INTENT: embedded-postgres.ts (helpers module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/__tests__/helpers/embedded-postgres.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestSupport,
} from "@paperclipai/db";
// [END: module]
