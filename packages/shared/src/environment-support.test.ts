/**
 * FILE: packages/shared/src/environment-support.test.ts
 * ABOUT: environment-support.test.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - environment-support.test.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: environment-support.test.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/environment-support.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { isSandboxProviderSupportedForAdapter } from "./environment-support.js";

describe("isSandboxProviderSupportedForAdapter", () => {
  it("accepts additional sandbox providers for remote-managed adapters", () => {
    expect(
      isSandboxProviderSupportedForAdapter("codex_local", "fake-plugin", ["fake-plugin"]),
    ).toBe(true);
  });

  it("rejects providers for adapters without remote-managed environment support", () => {
    expect(
      isSandboxProviderSupportedForAdapter("openclaw", "fake-plugin", ["fake-plugin"]),
    ).toBe(false);
  });
});
// [END: module]
