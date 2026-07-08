/**
 * FILE: packages/plugins/sandbox-providers/cloudflare/vitest.config.ts
 * ABOUT: vitest.config.ts (cloudflare module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (cloudflare module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (cloudflare module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/sandbox-providers/cloudflare/vitest.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "bridge-template/src/**/*.test.ts"],
    environment: "node",
  },
});
// [END: module]
