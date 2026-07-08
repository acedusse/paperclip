/**
 * FILE: cli/src/prompts/llm.ts
 * ABOUT: llm.ts (prompts module).
 *
 * SECTIONS:
 *   [TAG: module] - llm.ts (prompts module).
 */
// ==========================================
// [META: module]
// INTENT: llm.ts (prompts module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/prompts/llm.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import * as p from "@clack/prompts";
import type { LlmConfig } from "../config/schema.js";

export async function promptLlm(): Promise<LlmConfig | undefined> {
  const configureLlm = await p.confirm({
    message: "Configure an LLM provider now?",
    initialValue: false,
  });

  if (p.isCancel(configureLlm)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  if (!configureLlm) return undefined;

  const provider = await p.select({
    message: "LLM provider",
    options: [
      { value: "claude" as const, label: "Claude (Anthropic)" },
      { value: "openai" as const, label: "OpenAI" },
    ],
  });

  if (p.isCancel(provider)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const apiKey = await p.password({
    message: `${provider === "claude" ? "Anthropic" : "OpenAI"} API key`,
    validate: (val) => {
      if (!val) return "API key is required";
    },
  });

  if (p.isCancel(apiKey)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  return { provider, apiKey };
}
// [END: module]
