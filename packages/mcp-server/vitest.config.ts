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
    // Never collect build output. `tsc -b` emits compiled copies of the test
    // files into dist/, and collecting those runs every suite twice against
    // stale JS. Vitest's default exclude is replaced rather than merged once a
    // project sets its own test options, and a root-level exclude does not
    // propagate into projects, so each project must state it.
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
  },
});
// [END: module]
