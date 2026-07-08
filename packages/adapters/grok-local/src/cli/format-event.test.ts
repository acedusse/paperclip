/**
 * FILE: packages/adapters/grok-local/src/cli/format-event.test.ts
 * ABOUT: format-event.test.ts (cli module).
 *
 * SECTIONS:
 *   [TAG: module] - format-event.test.ts (cli module).
 */
// ==========================================
// [META: module]
// INTENT: format-event.test.ts (cli module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapters/grok-local/src/cli/format-event.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { afterEach, describe, expect, it, vi } from "vitest";
import { printGrokStreamEvent } from "./format-event.js";

describe("printGrokStreamEvent", () => {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});

  afterEach(() => {
    spy.mockClear();
  });

  it("prints thought/text/end events", () => {
    printGrokStreamEvent(JSON.stringify({ type: "thought", data: "Plan" }), false);
    printGrokStreamEvent(JSON.stringify({ type: "text", data: "hello" }), false);
    printGrokStreamEvent(JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "sess-1" }), false);

    expect(spy.mock.calls.flat()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("thinking: Plan"),
        expect.stringContaining("assistant: hello"),
        expect.stringContaining("Grok run completed"),
      ]),
    );
  });
});
// [END: module]
