/**
 * FILE: tests/release-smoke/playwright.config.ts
 * ABOUT: playwright.config.ts (release-smoke module).
 *
 * SECTIONS:
 *   [TAG: module] - playwright.config.ts (release-smoke module).
 */
// ==========================================
// [META: module]
// INTENT: playwright.config.ts (release-smoke module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "tests/release-smoke/playwright.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "@playwright/test";

const BASE_URL =
  process.env.PAPERCLIP_RELEASE_SMOKE_BASE_URL ?? "http://127.0.0.1:3232";
const PLAYWRIGHT_CHANNEL = process.env.PAPERCLIP_PLAYWRIGHT_CHANNEL;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        ...(PLAYWRIGHT_CHANNEL ? { channel: PLAYWRIGHT_CHANNEL } : {}),
      },
    },
  ],
  outputDir: "./test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
});
// [END: module]
