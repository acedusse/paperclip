/**
 * FILE: ui/src/lib/new-agent-runtime-config.ts
 * ABOUT: new-agent-runtime-config.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - new-agent-runtime-config.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: new-agent-runtime-config.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/new-agent-runtime-config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { AGENT_DEFAULT_MAX_CONCURRENT_RUNS } from "@paperclipai/shared";
import { defaultCreateValues } from "../components/agent-config-defaults";

export function buildNewAgentRuntimeConfig(input?: {
  heartbeatEnabled?: boolean;
  intervalSec?: number;
  cheapModel?: string;
  cheapModelEnabled?: boolean;
}): Record<string, unknown> {
  const config: Record<string, unknown> = {
    heartbeat: {
      enabled: input?.heartbeatEnabled ?? defaultCreateValues.heartbeatEnabled,
      intervalSec: input?.intervalSec ?? defaultCreateValues.intervalSec,
      wakeOnDemand: true,
      cooldownSec: 10,
      maxConcurrentRuns: AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
    },
  };

  const cheapModel = input?.cheapModel?.trim() ?? "";
  const cheapEnabled = input?.cheapModelEnabled ?? false;
  if (cheapModel && cheapEnabled) {
    config.modelProfiles = {
      cheap: {
        enabled: true,
        adapterConfig: { model: cheapModel },
      },
    };
  }

  return config;
}
// [END: module]
