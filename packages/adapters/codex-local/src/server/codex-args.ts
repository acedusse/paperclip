/**
 * FILE: packages/adapters/codex-local/src/server/codex-args.ts
 * ABOUT: codex-args.ts (server module).
 *
 * SECTIONS:
 *   [TAG: module] - codex-args.ts (server module).
 */
// ==========================================
// [META: module]
// INTENT: codex-args.ts (server module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapters/codex-local/src/server/codex-args.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { asBoolean, asString, asStringArray } from "@paperclipai/adapter-utils/server-utils";
import {
  CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS,
  isCodexLocalFastModeSupported,
} from "../index.js";

export type BuildCodexExecArgsResult = {
  args: string[];
  model: string;
  fastModeRequested: boolean;
  fastModeApplied: boolean;
  fastModeIgnoredReason: string | null;
};

function readExtraArgs(config: unknown): string[] {
  const fromExtraArgs = asStringArray(asRecord(config).extraArgs);
  if (fromExtraArgs.length > 0) return fromExtraArgs;
  return asStringArray(asRecord(config).args);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatFastModeSupportedModels(): string {
  return `${CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS.join(", ")} or manually configured model IDs`;
}

export function buildCodexExecArgs(
  config: unknown,
  options: {
    resumeSessionId?: string | null;
    skipGitRepoCheck?: boolean;
  } = {},
): BuildCodexExecArgsResult {
  const record = asRecord(config);
  const model = asString(record.model, "").trim();
  const modelReasoningEffort = asString(
    record.modelReasoningEffort,
    asString(record.reasoningEffort, ""),
  ).trim();
  const search = asBoolean(record.search, false);
  const fastModeRequested = asBoolean(record.fastMode, false);
  const fastModeApplied = fastModeRequested && isCodexLocalFastModeSupported(model);
  const bypass = asBoolean(
    record.dangerouslyBypassApprovalsAndSandbox,
    asBoolean(record.dangerouslyBypassSandbox, false),
  );
  const extraArgs = readExtraArgs(record);

  const args = ["exec", "--json"];
  if (options.skipGitRepoCheck) args.push("--skip-git-repo-check");
  if (search) args.unshift("--search");
  if (bypass) args.push("--dangerously-bypass-approvals-and-sandbox");
  if (model) args.push("--model", model);
  if (modelReasoningEffort) {
    args.push("-c", `model_reasoning_effort=${JSON.stringify(modelReasoningEffort)}`);
  }
  if (fastModeApplied) {
    args.push("-c", 'service_tier="fast"', "-c", "features.fast_mode=true");
  }
  if (extraArgs.length > 0) args.push(...extraArgs);
  if (options.resumeSessionId) args.push("resume", options.resumeSessionId, "-");
  else args.push("-");

  return {
    args,
    model,
    fastModeRequested,
    fastModeApplied,
    fastModeIgnoredReason:
      fastModeRequested && !fastModeApplied
        ? `Configured fast mode is currently only supported on ${formatFastModeSupportedModels()}; Paperclip will ignore it for model ${model || "(default)"}.`
        : null,
  };
}
// [END: module]
