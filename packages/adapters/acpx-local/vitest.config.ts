/**
 * FILE: packages/adapters/acpx-local/vitest.config.ts
 * ABOUT: vitest.config.ts (acpx-local module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (acpx-local module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (acpx-local module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapters/acpx-local/vitest.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
// [END: module]
