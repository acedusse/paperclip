/**
 * FILE: packages/teams-catalog/vitest.config.ts
 * ABOUT: vitest.config.ts (teams-catalog module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (teams-catalog module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (teams-catalog module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/teams-catalog/vitest.config.ts", "imports": "see code", "exports": "see code"}
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
