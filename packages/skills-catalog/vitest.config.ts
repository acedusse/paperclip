/**
 * FILE: packages/skills-catalog/vitest.config.ts
 * ABOUT: vitest.config.ts (skills-catalog module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (skills-catalog module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (skills-catalog module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/skills-catalog/vitest.config.ts", "imports": "see code", "exports": "see code"}
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
