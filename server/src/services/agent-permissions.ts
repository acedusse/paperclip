/**
 * FILE: server/src/services/agent-permissions.ts
 * ABOUT: agent-permissions.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - agent-permissions.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: agent-permissions.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/agent-permissions.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export type NormalizedAgentPermissions = Record<string, unknown> & {
  canCreateAgents: boolean;
};

export function defaultPermissionsForRole(role: string): NormalizedAgentPermissions {
  return {
    canCreateAgents: role.trim().toLowerCase() === "ceo",
  };
}

export function normalizeAgentPermissions(
  permissions: unknown,
  role: string,
): NormalizedAgentPermissions {
  const defaults = defaultPermissionsForRole(role);
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    return defaults;
  }

  const record = permissions as Record<string, unknown>;
  const preserved = { ...record };
  return {
    ...preserved,
    canCreateAgents:
      typeof record.canCreateAgents === "boolean"
        ? record.canCreateAgents
        : defaults.canCreateAgents,
  };
}
// [END: module]
