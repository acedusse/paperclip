/**
 * FILE: server/src/__tests__/documents.test.ts
 * ABOUT: documents.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - documents.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: documents.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/documents.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { extractLegacyPlanBody } from "../services/documents.js";

describe("extractLegacyPlanBody", () => {
  it("returns null when no plan block exists", () => {
    expect(extractLegacyPlanBody("hello world")).toBeNull();
  });

  it("extracts plan body from legacy issue descriptions", () => {
    expect(
      extractLegacyPlanBody(`
intro

<plan>

# Plan

- one
- two

</plan>
      `),
    ).toBe("# Plan\n\n- one\n- two");
  });

  it("ignores empty plan blocks", () => {
    expect(extractLegacyPlanBody("<plan>   </plan>")).toBeNull();
  });
});
// [END: module]
