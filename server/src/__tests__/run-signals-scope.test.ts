/**
 * FILE: server/src/__tests__/run-signals-scope.test.ts
 * ABOUT: run-signals-scope.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - run-signals-scope.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: run-signals-scope.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/run-signals-scope.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  ACTIVE_RUN_STATUSES,
  isActiveRunStatus,
  isTerminalRunStatus,
  MAX_RUNS_FOR_STREAK,
  TERMINAL_RUN_STATUSES,
} from "../services/run-signals/scope.ts";

describe("run-signals scope constants", () => {
  it("treats every terminal status as terminal and not active", () => {
    for (const status of TERMINAL_RUN_STATUSES) {
      expect(isTerminalRunStatus(status)).toBe(true);
      expect(isActiveRunStatus(status)).toBe(false);
    }
  });

  it("treats every active status as active and not terminal", () => {
    for (const status of ACTIVE_RUN_STATUSES) {
      expect(isActiveRunStatus(status)).toBe(true);
      expect(isTerminalRunStatus(status)).toBe(false);
    }
  });

  it("classifies an unknown status as neither", () => {
    expect(isTerminalRunStatus("wound_down")).toBe(false);
    expect(isActiveRunStatus("wound_down")).toBe(false);
  });

  it("caps the streak walk at 100 runs", () => {
    expect(MAX_RUNS_FOR_STREAK).toBe(100);
  });
});
// [END: module]
