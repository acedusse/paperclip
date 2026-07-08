/**
 * FILE: ui/src/components/agent-config-defaults.ts
 * ABOUT: agent-config-defaults.ts (components module).
 *
 * SECTIONS:
 *   [TAG: module] - agent-config-defaults.ts (components module).
 */
// ==========================================
// [META: module]
// INTENT: agent-config-defaults.ts (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/agent-config-defaults.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { CreateConfigValues } from "@paperclipai/adapter-utils";

export const defaultCreateValues: CreateConfigValues = {
  adapterType: "claude_local",
  cwd: "",
  instructionsFilePath: "",
  promptTemplate: "",
  model: "",
  thinkingEffort: "",
  chrome: false,
  dangerouslySkipPermissions: true,
  search: false,
  fastMode: false,
  dangerouslyBypassSandbox: false,
  command: "",
  args: "",
  extraArgs: "",
  envVars: "",
  envBindings: {},
  url: "",
  bootstrapPrompt: "",
  payloadTemplateJson: "",
  workspaceStrategyType: "project_primary",
  workspaceBaseRef: "",
  workspaceBranchTemplate: "",
  worktreeParentDir: "",
  runtimeServicesJson: "",
  maxTurnsPerRun: 1000,
  heartbeatEnabled: false,
  intervalSec: 300,
  // openclaw_gateway defaults
  authToken: "",
  agentId: "",
  sessionKeyStrategy: "issue",
  sessionKey: "",
  timeoutSec: undefined,
  waitTimeoutMs: undefined,
  disableDeviceAuth: undefined,
  autoPairOnFirstConnect: undefined,
  devicePrivateKeyPem: "",
  role: "",
  scopes: "",
  paperclipApiUrl: "",
  headersJson: "",
  password: "",
};
// [END: module]
