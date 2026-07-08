/**
 * FILE: server/src/services/session-workspace-cwd.ts
 * ABOUT: session-workspace-cwd.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - session-workspace-cwd.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: session-workspace-cwd.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/session-workspace-cwd.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import path from "node:path";

const SESSION_CWD_SYSTEM_ROOTS = new Set([
  "/",
  "/tmp",
  "/var",
  "/var/tmp",
  "/var/run",
  "/usr",
  "/etc",
  "/proc",
  "/sys",
  "/dev",
  "/run",
  "/private",
  "/private/tmp",
]);

export function isUnsafeSessionWorkspaceCwd(cwd: string | null | undefined): boolean {
  const value = typeof cwd === "string" && cwd.trim().length > 0 ? cwd.trim() : null;
  if (!value) return false;
  const normalized = path.normalize(value.replace(/\/+$/, "") || "/");
  return SESSION_CWD_SYSTEM_ROOTS.has(normalized);
}
// [END: module]
