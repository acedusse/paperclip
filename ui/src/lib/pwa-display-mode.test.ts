/**
 * FILE: ui/src/lib/pwa-display-mode.test.ts
 * ABOUT: pwa-display-mode.test.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - pwa-display-mode.test.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: pwa-display-mode.test.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/pwa-display-mode.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { isChromelessDisplayMode } from "./pwa-display-mode";

function matchMode(activeMode: string | null) {
  return (query: string) => ({ matches: query === `(display-mode: ${activeMode})` });
}

describe("isChromelessDisplayMode", () => {
  it("detects standalone display mode from media queries", () => {
    expect(isChromelessDisplayMode(matchMode("standalone"), false)).toBe(true);
  });

  it("detects fullscreen display mode from media queries", () => {
    expect(isChromelessDisplayMode(matchMode("fullscreen"), false)).toBe(true);
  });

  it("detects window-controls-overlay display mode from media queries", () => {
    expect(isChromelessDisplayMode(matchMode("window-controls-overlay"), false)).toBe(true);
  });

  it("detects iOS home-screen standalone launches", () => {
    expect(isChromelessDisplayMode(matchMode(null), true)).toBe(true);
  });

  it("ignores normal browser launches", () => {
    expect(isChromelessDisplayMode(matchMode("browser"), false)).toBe(false);
  });
});
// [END: module]
