/**
 * FILE: packages/adapters/pi-local/src/server/models.test.ts
 * ABOUT: models.test.ts (server module).
 *
 * SECTIONS:
 *   [TAG: module] - models.test.ts (server module).
 */
// ==========================================
// [META: module]
// INTENT: models.test.ts (server module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapters/pi-local/src/server/models.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { afterEach, describe, expect, it } from "vitest";
import {
  ensurePiModelConfiguredAndAvailable,
  listPiModels,
  resetPiModelsCacheForTests,
} from "./models.js";

describe("pi models", () => {
  afterEach(() => {
    delete process.env.PAPERCLIP_PI_COMMAND;
    resetPiModelsCacheForTests();
  });

  it("returns an empty list when discovery command is unavailable", async () => {
    process.env.PAPERCLIP_PI_COMMAND = "__paperclip_missing_pi_command__";
    await expect(listPiModels()).resolves.toEqual([]);
  });

  it("rejects when model is missing", async () => {
    await expect(
      ensurePiModelConfiguredAndAvailable({ model: "" }),
    ).rejects.toThrow("Pi requires `adapterConfig.model`");
  });

  it("rejects when discovery cannot run for configured model", async () => {
    process.env.PAPERCLIP_PI_COMMAND = "__paperclip_missing_pi_command__";
    await expect(
      ensurePiModelConfiguredAndAvailable({
        model: "xai/grok-4",
      }),
    ).rejects.toThrow();
  });
});
// [END: module]
