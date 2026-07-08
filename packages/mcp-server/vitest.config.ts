/**
 * FILE: packages/mcp-server/vitest.config.ts
 * ABOUT: vitest.config.ts (mcp-server module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (mcp-server module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (mcp-server module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/mcp-server/vitest.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
// [END: module]
