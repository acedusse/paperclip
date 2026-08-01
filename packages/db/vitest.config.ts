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
    // Never collect build output. `tsc -b` emits compiled copies of the test
    // files into dist/, and collecting those runs every suite twice against
    // stale JS. Vitest's default exclude is replaced rather than merged once a
    // project sets its own test options, and a root-level exclude does not
    // propagate into projects, so each project must state it.
    exclude: ["**/node_modules/**", "**/dist/**"],
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
