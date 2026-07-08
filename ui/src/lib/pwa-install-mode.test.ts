/**
 * FILE: ui/src/lib/pwa-install-mode.test.ts
 * ABOUT: pwa-install-mode.test.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - pwa-install-mode.test.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: pwa-install-mode.test.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/pwa-install-mode.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const uiRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("PWA install mode", () => {
  it("opens home-screen launches with browser controls visible", () => {
    const manifest = JSON.parse(readFileSync(resolve(uiRoot, "public/site.webmanifest"), "utf8")) as {
      display?: string;
    };
    const html = readFileSync(resolve(uiRoot, "index.html"), "utf8");

    expect(manifest.display).toBe("browser");
    expect(html).not.toContain('name="mobile-web-app-capable"');
    expect(html).not.toContain('name="apple-mobile-web-app-capable"');
    expect(html).not.toContain('name="apple-mobile-web-app-status-bar-style"');
  });
});
// [END: module]
