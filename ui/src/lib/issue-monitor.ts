/**
 * FILE: ui/src/lib/issue-monitor.ts
 * ABOUT: issue-monitor.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - issue-monitor.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: issue-monitor.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/issue-monitor.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function formatMonitorOffset(nextCheckAt: Date | string): string {
  const deltaMs = new Date(nextCheckAt).getTime() - Date.now();
  const absMinutes = Math.round(Math.abs(deltaMs) / 60_000);
  if (absMinutes <= 0) return "now";
  if (absMinutes < 60) return deltaMs >= 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;

  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return deltaMs >= 0 ? `in ${absHours}h` : `${absHours}h ago`;

  const absDays = Math.round(absHours / 24);
  return deltaMs >= 0 ? `in ${absDays}d` : `${absDays}d ago`;
}
// [END: module]
