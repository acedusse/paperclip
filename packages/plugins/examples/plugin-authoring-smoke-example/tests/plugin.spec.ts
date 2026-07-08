/**
 * FILE: packages/plugins/examples/plugin-authoring-smoke-example/tests/plugin.spec.ts
 * ABOUT: plugin.spec.ts (tests module).
 *
 * SECTIONS:
 *   [TAG: module] - plugin.spec.ts (tests module).
 */
// ==========================================
// [META: module]
// INTENT: plugin.spec.ts (tests module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/examples/plugin-authoring-smoke-example/tests/plugin.spec.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

describe("plugin scaffold", () => {
  it("declares capabilities for its manifest features", () => {
    expect(manifest.capabilities).toContain("events.subscribe");
    expect(manifest.capabilities).toContain("ui.dashboardWidget.register");
  });

  it("registers data + actions and handles events", async () => {
    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities, "events.emit"] });
    await plugin.definition.setup(harness.ctx);

    await harness.emit("issue.created", { issueId: "iss_1" }, { entityId: "iss_1", entityType: "issue" });
    expect(harness.getState({ scopeKind: "issue", scopeId: "iss_1", stateKey: "seen" })).toBe(true);

    const data = await harness.getData<{ status: string }>("health");
    expect(data.status).toBe("ok");

    const action = await harness.performAction<{ pong: boolean }>("ping");
    expect(action.pong).toBe(true);
  });
});
// [END: module]
