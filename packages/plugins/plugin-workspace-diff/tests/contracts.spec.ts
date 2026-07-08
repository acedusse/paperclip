/**
 * FILE: packages/plugins/plugin-workspace-diff/tests/contracts.spec.ts
 * ABOUT: contracts.spec.ts (tests module).
 *
 * SECTIONS:
 *   [TAG: module] - contracts.spec.ts (tests module).
 */
// ==========================================
// [META: module]
// INTENT: contracts.spec.ts (tests module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/plugin-workspace-diff/tests/contracts.spec.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { workspaceDiffQuerySchema, workspaceDiffResponseSchema } from "../src/contracts.js";
import { diffResponse } from "./fixtures.js";

describe("workspace diff plugin contracts", () => {
  it("normalizes query options from plugin data parameters", () => {
    expect(workspaceDiffQuerySchema.parse({
      view: "head",
      baseRef: " main ",
      includeUntracked: "false",
      path: ["src/app.ts, README.md", "packages/shared/src/index.ts"],
    })).toEqual({
      view: "head",
      baseRef: "main",
      includeUntracked: false,
      paths: ["src/app.ts", "README.md", "packages/shared/src/index.ts"],
    });
  });

  it("validates the plugin-owned response shape", () => {
    expect(workspaceDiffResponseSchema.parse(diffResponse())).toMatchObject({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      stats: { fileCount: 1 },
    });
  });
});
// [END: module]
