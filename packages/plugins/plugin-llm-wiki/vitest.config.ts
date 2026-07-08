/**
 * FILE: packages/plugins/plugin-llm-wiki/vitest.config.ts
 * ABOUT: vitest.config.ts (plugin-llm-wiki module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (plugin-llm-wiki module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (plugin-llm-wiki module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/plugin-llm-wiki/vitest.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts"],
    environment: "node",
  },
});
// [END: module]
