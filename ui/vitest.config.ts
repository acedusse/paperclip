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
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
// [END: module]
