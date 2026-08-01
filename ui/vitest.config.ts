/**
 * FILE: ui/vitest.config.ts
 * ABOUT: vitest.config.ts (ui module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (ui module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (ui module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/vitest.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      lexical: path.resolve(__dirname, "./node_modules/lexical/Lexical.mjs"),
    },
  },
  test: {
    // Never collect build output. `tsc -b` emits compiled copies of the test
    // files into dist/, and collecting those runs every suite twice against
    // stale JS. Vitest's default exclude is replaced rather than merged once a
    // project sets its own test options, and a root-level exclude does not
    // propagate into projects, so each project must state it.
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Pin the timezone. Components format dates for display, so an unpinned
    // TZ makes those assertions pass or fail depending on where the suite
    // runs — e.g. a midnight-UTC fixture renders as the previous day in any
    // negative-offset zone. Pinning here fixes the whole class of failure
    // rather than one fixture at a time.
    env: { TZ: "UTC" },
  },
});
// [END: module]
