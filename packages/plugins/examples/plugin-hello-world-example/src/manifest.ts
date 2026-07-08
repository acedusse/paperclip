/**
 * FILE: packages/plugins/examples/plugin-hello-world-example/src/manifest.ts
 * ABOUT: manifest.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - manifest.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: manifest.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/examples/plugin-hello-world-example/src/manifest.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

/**
 * Stable plugin ID used by host registration and namespacing.
 */
const PLUGIN_ID = "paperclip.hello-world-example";
const PLUGIN_VERSION = "0.1.0";
const DASHBOARD_WIDGET_SLOT_ID = "hello-world-dashboard-widget";
const DASHBOARD_WIDGET_EXPORT_NAME = "HelloWorldDashboardWidget";

/**
 * Minimal manifest demonstrating a UI-only plugin with one dashboard widget slot.
 */
const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Hello World Widget (Example)",
  description: "Reference UI plugin that adds a simple Hello World widget to the Paperclip dashboard.",
  author: "Paperclip",
  categories: ["ui"],
  capabilities: ["ui.dashboardWidget.register"],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: DASHBOARD_WIDGET_SLOT_ID,
        displayName: "Hello World",
        exportName: DASHBOARD_WIDGET_EXPORT_NAME,
      },
    ],
  },
};

export default manifest;
// [END: module]
