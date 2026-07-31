/**
 * FILE: server/vitest.config.ts
 * ABOUT: vitest.config.ts (server module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (server module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (server module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/vitest.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Never collect build output. `tsc -b server` emits compiled copies of the
    // test files into dist/, and picking those up runs every suite twice
    // against stale JS — which surfaces as failures in tests nobody touched.
    // Vitest's default exclude is replaced, not merged, whenever `include` or
    // `exclude` is set anywhere, so state it explicitly here.
    exclude: ["**/node_modules/**", "**/dist/**"],
    isolate: true,
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    pool: "forks",
    sequence: {
      concurrent: false,
      hooks: "list",
    },
    setupFiles: ["./src/__tests__/setup-supertest.ts"],
  },
});
// [END: module]
