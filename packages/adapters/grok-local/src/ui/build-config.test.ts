/**
 * FILE: packages/adapters/grok-local/src/ui/build-config.test.ts
 * ABOUT: build-config.test.ts (ui module).
 *
 * SECTIONS:
 *   [TAG: module] - build-config.test.ts (ui module).
 */
// ==========================================
// [META: module]
// INTENT: build-config.test.ts (ui module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapters/grok-local/src/ui/build-config.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { buildGrokLocalConfig } from "./build-config.js";

describe("buildGrokLocalConfig", () => {
  it("maps create-form values into adapter config", () => {
    expect(buildGrokLocalConfig({
      cwd: "/tmp/project",
      instructionsFilePath: "/tmp/AGENTS.md",
      model: "grok-build",
      thinkingEffort: "high",
      envVars: "XAI_API_KEY=secret\n",
      extraArgs: "--check, --verbatim",
    } as never)).toEqual({
      cwd: "/tmp/project",
      instructionsFilePath: "/tmp/AGENTS.md",
      model: "grok-build",
      timeoutSec: 0,
      graceSec: 20,
      reasoningEffort: "high",
      env: {
        XAI_API_KEY: { type: "plain", value: "secret" },
      },
      extraArgs: ["--check", "--verbatim"],
    });
  });
});
// [END: module]
