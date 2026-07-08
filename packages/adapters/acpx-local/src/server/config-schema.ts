/**
 * FILE: packages/adapters/acpx-local/src/server/config-schema.ts
 * ABOUT: config-schema.ts (server module).
 *
 * SECTIONS:
 *   [TAG: module] - config-schema.ts (server module).
 */
// ==========================================
// [META: module]
// INTENT: config-schema.ts (server module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapters/acpx-local/src/server/config-schema.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";
import {
  DEFAULT_ACPX_LOCAL_AGENT,
  DEFAULT_ACPX_LOCAL_NON_INTERACTIVE_PERMISSIONS,
  DEFAULT_ACPX_LOCAL_TIMEOUT_SEC,
  DEFAULT_ACPX_LOCAL_WARM_HANDLE_IDLE_MS,
  acpxAgentOptions,
} from "../index.js";

export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "agent",
        label: "ACP agent",
        type: "select",
        default: DEFAULT_ACPX_LOCAL_AGENT,
        required: true,
        options: acpxAgentOptions.map((agent) => ({ value: agent.id, label: agent.label })),
        hint: "Choose the ACP agent launched through ACPX.",
      },
      {
        key: "agentCommand",
        label: "Agent command",
        type: "text",
        hint: "Required for custom agents; optional override for built-in Claude or Codex ACP commands.",
      },
      {
        key: "nonInteractivePermissions",
        label: "Non-interactive permissions",
        type: "select",
        default: DEFAULT_ACPX_LOCAL_NON_INTERACTIVE_PERMISSIONS,
        options: [
          { value: "deny", label: "Deny" },
          { value: "fail", label: "Fail" },
        ],
        hint: "Fallback if the ACP agent asks for input outside an interactive session. Paperclip still auto-approves permissions by default.",
      },
      {
        key: "cwd",
        label: "Working directory",
        type: "text",
        hint: "Absolute fallback directory. Paperclip execution workspaces can override this at runtime.",
      },
      {
        key: "stateDir",
        label: "State directory",
        type: "text",
        hint: "Optional ACPX session state directory. Defaults to Paperclip-managed company/agent scoped storage.",
      },
      {
        key: "fastMode",
        label: "Codex fast mode",
        type: "toggle",
        default: false,
        hint: "Only applies when ACP agent is Codex. Requests Codex Fast mode through ACP session config.",
        meta: { visibleWhen: { key: "agent", values: ["codex"] } },
      },
      {
        key: "timeoutSec",
        label: "Timeout seconds",
        type: "number",
        default: DEFAULT_ACPX_LOCAL_TIMEOUT_SEC,
      },
      {
        key: "warmHandleIdleMs",
        label: "Warm process idle ms",
        type: "number",
        default: DEFAULT_ACPX_LOCAL_WARM_HANDLE_IDLE_MS,
        hint: "Defaults to 0, which closes the ACPX process after each run while retaining persistent session state.",
      },
      {
        key: "env",
        label: "Environment JSON",
        type: "textarea",
        hint: "Optional JSON object of environment values or secret bindings.",
      },
    ],
  };
}
// [END: module]
