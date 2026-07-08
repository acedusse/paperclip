/**
 * FILE: ui/src/lib/work-mode-meta.test.ts
 * ABOUT: work-mode-meta.test.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - work-mode-meta.test.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: work-mode-meta.test.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/work-mode-meta.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";

import { nextWorkMode, titleForPendingWorkMode, workModeMetaList } from "./work-mode-meta";

describe("work mode metadata", () => {
  it("orders issue work modes as agent, planning, then ask", () => {
    expect(workModeMetaList(false).map((mode) => mode.value)).toEqual(["standard", "planning", "ask"]);
    expect(workModeMetaList(true).map((mode) => mode.shortLabel)).toEqual(["Agent", "Plan", "Ask"]);
  });

  it("cycles issue work modes as agent, planning, ask, then agent", () => {
    expect(nextWorkMode("standard", true)).toBe("planning");
    expect(nextWorkMode("planning", true)).toBe("ask");
    expect(nextWorkMode("ask", true)).toBe("standard");
  });

  it("matches standard mode tooltip copy to the active surface", () => {
    expect(titleForPendingWorkMode("standard", false)).toBe("Standard mode for this submission. Click to change.");
    expect(titleForPendingWorkMode("standard", true)).toBe("Agent mode for this submission. Click to change.");
  });
});
// [END: module]
