/**
 * FILE: packages/shared/src/validators/adapter-registry.test.ts
 * ABOUT: adapter-registry.test.ts (validators module).
 *
 * SECTIONS:
 *   [TAG: module] - adapter-registry.test.ts (validators module).
 */
// ==========================================
// [META: module]
// INTENT: adapter-registry.test.ts (validators module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/validators/adapter-registry.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { adapterRegistrySchema } from "./adapter-registry.js";

describe("adapterRegistrySchema", () => {
  it("parses a full entry", () => {
    const parsed = adapterRegistrySchema.parse([
      {
        adapterType: "opencode_local",
        runtimeImage: "ghcr.io/paperclipai/agent-runtime-opencode:v1",
        envKeys: ["ANTHROPIC_API_KEY"],
        allowFqdns: [],
        probeCommand: ["opencode", "--version"],
        defaultEnv: { ANTHROPIC_BASE_URL: "http://bifrost.bifrost.svc.cluster.local:8080" },
      },
    ]);
    expect(parsed[0].adapterType).toBe("opencode_local");
    expect(parsed[0].enabled).toBe(true); // defaulted
    expect(parsed[0].defaultEnv?.ANTHROPIC_BASE_URL).toContain("bifrost");
  });

  it("defaults enabled to true and optional collections to undefined", () => {
    const parsed = adapterRegistrySchema.parse([{ adapterType: "pi_local" }]);
    expect(parsed[0]).toMatchObject({ adapterType: "pi_local", enabled: true });
    expect(parsed[0].runtimeImage).toBeUndefined();
  });

  it("rejects an entry with no adapterType", () => {
    expect(() => adapterRegistrySchema.parse([{ enabled: true }])).toThrow();
  });

  it("rejects a non-array", () => {
    expect(() => adapterRegistrySchema.parse({ adapterType: "x" })).toThrow();
  });
});
// [END: module]
