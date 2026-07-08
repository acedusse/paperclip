/**
 * FILE: ui/src/api/workspace-runtime-control.ts
 * ABOUT: workspace-runtime-control.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - workspace-runtime-control.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: workspace-runtime-control.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/workspace-runtime-control.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { WorkspaceRuntimeControlTarget } from "@paperclipai/shared";

export function sanitizeWorkspaceRuntimeControlTarget(
  target: WorkspaceRuntimeControlTarget = {},
): WorkspaceRuntimeControlTarget {
  return {
    workspaceCommandId: target.workspaceCommandId ?? null,
    runtimeServiceId: target.runtimeServiceId ?? null,
    serviceIndex: target.serviceIndex ?? null,
  };
}
// [END: module]
