/**
 * FILE: server/src/__tests__/feedback-flush-controller.test.ts
 * ABOUT: feedback-flush-controller.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - feedback-flush-controller.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: feedback-flush-controller.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/feedback-flush-controller.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { isDatabaseConnectionUnavailableError } from "../app.js";

describe("feedback export flush error classification", () => {
  it("recognizes wrapped database connection-refused errors", () => {
    const error = new Error("Failed query: select ...: connect ECONNREFUSED 127.0.0.1:54329");
    (error as { cause?: unknown }).cause = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:54329"),
      { code: "ECONNREFUSED" },
    );

    expect(isDatabaseConnectionUnavailableError(error)).toBe(true);
  });

  it("does not classify ordinary feedback upload failures as database outages", () => {
    expect(isDatabaseConnectionUnavailableError(new Error("upstream returned 500"))).toBe(false);
  });

  it("does not trust unrelated error messages that mention ECONNREFUSED", () => {
    expect(isDatabaseConnectionUnavailableError(
      new Error("feedback upload payload mentioned ECONNREFUSED in user content"),
    )).toBe(false);
  });
});
// [END: module]
