/**
 * FILE: packages/plugins/examples/plugin-authoring-smoke-example/src/manifest.ts
 * ABOUT: manifest.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - manifest.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: manifest.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/examples/plugin-authoring-smoke-example/src/manifest.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclipai.plugin-authoring-smoke-example",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Plugin Authoring Smoke Example",
  description: "A Paperclip plugin",
  author: "Plugin Author",
  categories: ["connector"],
  capabilities: [
    "events.subscribe",
    "plugin.state.read",
    "plugin.state.write",
    "ui.dashboardWidget.register"
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: "health-widget",
        displayName: "Plugin Authoring Smoke Example Health",
        exportName: "DashboardWidget"
      }
    ]
  }
};

export default manifest;
// [END: module]
