/**
 * FILE: server/src/services/adapter-models-env.test.ts
 * ABOUT: adapter-models-env.test.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - adapter-models-env.test.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: adapter-models-env.test.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/adapter-models-env.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { parseAdapterModelsEnv } from "./adapter-models-env.js";

const ENV = JSON.stringify({
  opencode_local: [
    { id: "tensorix/deepseek/deepseek-chat-v3.1", label: "DeepSeek v3.1" },
    { id: "tensorix/z-ai/glm-4.7", label: "GLM 4.7" },
  ],
});

describe("parseAdapterModelsEnv", () => {
  it("returns null when unset", () => {
    expect(parseAdapterModelsEnv({})).toBeNull();
  });
  it("parses the per-adapter model map", () => {
    const m = parseAdapterModelsEnv({ PAPERCLIP_ADAPTER_MODELS: ENV });
    expect(m?.opencode_local?.[0]).toEqual({ id: "tensorix/deepseek/deepseek-chat-v3.1", label: "DeepSeek v3.1" });
    expect(m?.opencode_local?.length).toBe(2);
  });
  it("defaults label to id when omitted", () => {
    const m = parseAdapterModelsEnv({ PAPERCLIP_ADAPTER_MODELS: JSON.stringify({ pi_local: [{ id: "tensorix/x/y" }] }) });
    expect(m?.pi_local?.[0]).toEqual({ id: "tensorix/x/y", label: "tensorix/x/y" });
  });
  it("throws on invalid JSON (fail loud)", () => {
    expect(() => parseAdapterModelsEnv({ PAPERCLIP_ADAPTER_MODELS: "{bad" })).toThrow(/PAPERCLIP_ADAPTER_MODELS/);
  });
  it("throws when an entry lacks a string id", () => {
    expect(() => parseAdapterModelsEnv({ PAPERCLIP_ADAPTER_MODELS: JSON.stringify({ a: [{ label: "x" }] }) })).toThrow();
  });
});
// [END: module]
