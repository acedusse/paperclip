/**
 * FILE: packages/adapter-utils/src/billing.test.ts
 * ABOUT: billing.test.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - billing.test.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: billing.test.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapter-utils/src/billing.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { inferOpenAiCompatibleBiller } from "./billing.js";
import { LOCAL_INFERENCE_ENV_VAR } from "./local-inference.js";

describe("inferOpenAiCompatibleBiller", () => {
  it("returns openrouter when OPENROUTER_API_KEY is present", () => {
    expect(
      inferOpenAiCompatibleBiller({ OPENROUTER_API_KEY: "sk-or-123" } as NodeJS.ProcessEnv, "openai"),
    ).toBe("openrouter");
  });

  it("returns openrouter when OPENAI_BASE_URL points at OpenRouter", () => {
    expect(
      inferOpenAiCompatibleBiller(
        { OPENAI_BASE_URL: "https://openrouter.ai/api/v1" } as NodeJS.ProcessEnv,
        "openai",
      ),
    ).toBe("openrouter");
  });

  it("returns fallback when no OpenRouter markers are present", () => {
    expect(
      inferOpenAiCompatibleBiller(
        { OPENAI_BASE_URL: "https://api.openai.com/v1" } as NodeJS.ProcessEnv,
        "openai",
      ),
    ).toBe("openai");
  });

  // Local classification is checked ahead of the OpenRouter markers: a stale
  // OPENROUTER_API_KEY left in the environment must not mislabel a genuinely local run.
  it("returns local when a declared local endpoint is configured", () => {
    expect(
      inferOpenAiCompatibleBiller(
        {
          [LOCAL_INFERENCE_ENV_VAR]: "1",
          OPENAI_BASE_URL: "http://localhost:11434/v1",
        } as NodeJS.ProcessEnv,
        "openai",
      ),
    ).toBe("local");
  });

  it("prefers local over a stale OPENROUTER_API_KEY", () => {
    expect(
      inferOpenAiCompatibleBiller(
        {
          [LOCAL_INFERENCE_ENV_VAR]: "1",
          OPENAI_BASE_URL: "http://localhost:11434/v1",
          OPENROUTER_API_KEY: "sk-or-123",
        } as NodeJS.ProcessEnv,
        "openai",
      ),
    ).toBe("local");
  });

  it("leaves OpenRouter inference untouched when there is no local opt-in", () => {
    expect(
      inferOpenAiCompatibleBiller(
        { OPENAI_BASE_URL: "http://localhost:11434/v1", OPENROUTER_API_KEY: "sk-or-123" } as NodeJS.ProcessEnv,
        "openai",
      ),
    ).toBe("openrouter");
  });

  it("does not claim local for a loopback proxy that never opted in", () => {
    expect(
      inferOpenAiCompatibleBiller(
        { OPENAI_BASE_URL: "http://localhost:4000/v1" } as NodeJS.ProcessEnv,
        "openai",
      ),
    ).toBe("openai");
  });
});
// [END: module]
