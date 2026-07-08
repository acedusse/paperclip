/**
 * FILE: ui/src/api/workspace-runtime-control.test.ts
 * ABOUT: workspace-runtime-control.test.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - workspace-runtime-control.test.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: workspace-runtime-control.test.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/workspace-runtime-control.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { sanitizeWorkspaceRuntimeControlTarget } from "./workspace-runtime-control";

describe("sanitizeWorkspaceRuntimeControlTarget", () => {
  it("drops unexpected keys while preserving the selected runtime target", () => {
    const sanitized = sanitizeWorkspaceRuntimeControlTarget({
      workspaceCommandId: "web",
      runtimeServiceId: "service-1",
      serviceIndex: 2,
      ...( { action: "start" } as Record<string, unknown> ),
    });

    expect(sanitized).toEqual({
      workspaceCommandId: "web",
      runtimeServiceId: "service-1",
      serviceIndex: 2,
    });
    expect("action" in sanitized).toBe(false);
  });

  it("normalizes an omitted target to nullable fields", () => {
    expect(sanitizeWorkspaceRuntimeControlTarget()).toEqual({
      workspaceCommandId: null,
      runtimeServiceId: null,
      serviceIndex: null,
    });
  });
});
// [END: module]
