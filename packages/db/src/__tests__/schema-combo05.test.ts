/**
 * FILE: packages/db/src/__tests__/schema-combo05.test.ts
 * ABOUT: schema-combo05.test.ts (db test module).
 *
 * SECTIONS:
 *   [TAG: module] - schema-combo05.test.ts (db test module).
 */
// ==========================================
// [META: module]
// INTENT: schema-combo05.test.ts (db test module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/__tests__/schema-combo05.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, it, expect } from "vitest";
import { runChangesets, approvalRisk } from "../schema/index.js";

describe("combo05 schema", () => {
  it("exposes run_changesets and approval_risk tables", () => {
    expect(runChangesets).toBeDefined();
    expect(approvalRisk).toBeDefined();
  });
});
// [END: module]
