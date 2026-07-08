/**
 * FILE: cli/vitest.config.ts
 * ABOUT: vitest.config.ts (cli module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (cli module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (cli module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/vitest.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
// [END: module]
