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
});
// [END: module]
