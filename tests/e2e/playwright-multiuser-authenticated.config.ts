/**
 * FILE: tests/e2e/playwright-multiuser-authenticated.config.ts
 * ABOUT: playwright-multiuser-authenticated.config.ts (e2e module).
 *
 * SECTIONS:
 *   [TAG: module] - playwright-multiuser-authenticated.config.ts (e2e module).
 */
// ==========================================
// [META: module]
// INTENT: playwright-multiuser-authenticated.config.ts (e2e module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "tests/e2e/playwright-multiuser-authenticated.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PAPERCLIP_E2E_PORT ?? 3105);
const BASE_URL = process.env.PAPERCLIP_E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: "multi-user-authenticated.spec.ts",
  timeout: 180_000,
  expect: {
    timeout: 20_000,
  },
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
  outputDir: "./test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
});
// [END: module]
