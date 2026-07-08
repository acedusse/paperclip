/**
 * FILE: packages/plugins/examples/plugin-authoring-smoke-example/vitest.config.ts
 * ABOUT: vitest.config.ts (plugin-authoring-smoke-example module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (plugin-authoring-smoke-example module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (plugin-authoring-smoke-example module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/examples/plugin-authoring-smoke-example/vitest.config.ts", "imports": "see code", "exports": "see code"}
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
