/**
 * FILE: packages/plugins/create-paperclip-plugin/vitest.config.ts
 * ABOUT: vitest.config.ts (create-paperclip-plugin module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (create-paperclip-plugin module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (create-paperclip-plugin module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/create-paperclip-plugin/vitest.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
// [END: module]
