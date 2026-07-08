/**
 * FILE: packages/plugins/sandbox-providers/kubernetes/vitest.config.ts
 * ABOUT: vitest.config.ts (kubernetes module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest.config.ts (kubernetes module).
 */
// ==========================================
// [META: module]
// INTENT: vitest.config.ts (kubernetes module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/sandbox-providers/kubernetes/vitest.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/unit/**/*.test.ts",
      ...(process.env.RUN_K8S_INTEGRATION_TESTS === "1" ? ["test/integration/**/*.test.ts"] : []),
    ],
    testTimeout: process.env.RUN_K8S_INTEGRATION_TESTS === "1" ? 120_000 : 5_000,
    environment: "node",
  },
});
// [END: module]
