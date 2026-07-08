/**
 * FILE: packages/plugins/sandbox-providers/modal/vitest.config.ts
 * ABOUT: vitest.config.ts (modal module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (modal module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (modal module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/sandbox-providers/modal/vitest.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
// [END: module]
