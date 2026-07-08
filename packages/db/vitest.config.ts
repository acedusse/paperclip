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
    environment: "node",
  },
});
// [END: module]
