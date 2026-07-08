/**
 * FILE: tests/e2e/playwright-multiuser.config.ts
 * ABOUT: playwright-multiuser.config.ts (e2e module).
 *
 * SECTIONS:
 *   [TAG: module] - playwright-multiuser.config.ts (e2e module).
 */
// ==========================================
// [META: module]
// INTENT: playwright-multiuser.config.ts (e2e module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "tests/e2e/playwright-multiuser.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PAPERCLIP_E2E_PORT ?? 3104);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: "multi-user.spec.ts",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  // No webServer — expects an already-running server at BASE_URL.
  outputDir: "./test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
});
// [END: module]
