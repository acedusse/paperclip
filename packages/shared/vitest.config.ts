/**
 * FILE: packages/shared/vitest.config.ts
 * ABOUT: vitest.config.ts (shared module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (shared module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (shared module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/vitest.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
// [END: module]
