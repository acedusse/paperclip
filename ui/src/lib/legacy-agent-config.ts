/**
 * FILE: ui/src/lib/legacy-agent-config.ts
 * ABOUT: legacy-agent-config.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - legacy-agent-config.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: legacy-agent-config.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/legacy-agent-config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function hasLegacyWorkingDirectory(value: unknown): boolean {
  return asNonEmptyString(value) !== null;
}

export function shouldShowLegacyWorkingDirectoryField(input: {
  isCreate: boolean;
  adapterConfig: Record<string, unknown> | null | undefined;
}): boolean {
  if (input.isCreate) return false;
  return hasLegacyWorkingDirectory(input.adapterConfig?.cwd);
}
// [END: module]
