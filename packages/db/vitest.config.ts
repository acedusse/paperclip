/**
 * FILE: packages/db/vitest.config.ts
 * ABOUT: vitest.config.ts (db module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (db module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (db module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/vitest.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Embedded-Postgres lifecycle runs inside hooks: beforeAll does initdb, start,
    // and applyPendingMigrations; afterAll stops the server and recursively deletes
    // the whole data directory. Under a loaded suite that routinely exceeds vitest's
    // 10s default, which surfaces as "Hook timed out" on tests that themselves pass.
    // Long enough to absorb that, short enough that a genuinely hung hook still fails.
    hookTimeout: 60_000,
    environment: "node",
  },
});
// [END: module]
