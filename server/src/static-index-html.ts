/**
 * FILE: server/src/static-index-html.ts
 * ABOUT: static-index-html.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - static-index-html.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: static-index-html.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/static-index-html.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import fs from "node:fs";
import path from "node:path";
import { applyUiBranding } from "./ui-branding.js";

export function readBrandedStaticIndexHtml(uiDist: string): string {
  return applyUiBranding(fs.readFileSync(path.join(uiDist, "index.html"), "utf-8"));
}
// [END: module]
