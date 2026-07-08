/**
 * FILE: packages/plugins/sdk/vitest.config.ts
 * ABOUT: vitest.config.ts (sdk module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (sdk module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (sdk module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/sdk/vitest.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
// [END: module]
