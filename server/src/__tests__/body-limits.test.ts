/**
 * FILE: server/src/__tests__/body-limits.test.ts
 * ABOUT: body-limits.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - body-limits.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: body-limits.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/body-limits.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";

import {
  DEFAULT_JSON_BODY_LIMIT,
  PORTABLE_JSON_BODY_LIMIT,
  PORTABLE_JSON_BODY_LIMIT_BYTES,
} from "../http/body-limits.js";

describe("HTTP body limits", () => {
  it("keeps the global JSON parser at the established ceiling", () => {
    expect(DEFAULT_JSON_BODY_LIMIT).toBe("10mb");
  });

  it("allows PAP-scale portable import JSON payloads", () => {
    expect(PORTABLE_JSON_BODY_LIMIT).toBe("64mb");
    expect(PORTABLE_JSON_BODY_LIMIT_BYTES).toBe(64 * 1024 * 1024);
    expect(PORTABLE_JSON_BODY_LIMIT_BYTES).toBeGreaterThan(10 * 1024 * 1024);
  });
});
// [END: module]
