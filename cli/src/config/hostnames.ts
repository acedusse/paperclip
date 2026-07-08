/**
 * FILE: cli/src/config/hostnames.ts
 * ABOUT: hostnames.ts (config module).
 *
 * SECTIONS:
 *   [TAG: module] - hostnames.ts (config module).
 */
// ==========================================
// [META: module]
// INTENT: hostnames.ts (config module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/config/hostnames.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function normalizeHostnameInput(raw: string): string {
  const input = raw.trim();
  if (!input) {
    throw new Error("Hostname is required");
  }

  try {
    const url = input.includes("://") ? new URL(input) : new URL(`http://${input}`);
    const hostname = url.hostname.trim().toLowerCase();
    if (!hostname) throw new Error("Hostname is required");
    return hostname;
  } catch {
    throw new Error(`Invalid hostname: ${raw}`);
  }
}

export function parseHostnameCsv(raw: string): string[] {
  if (!raw.trim()) return [];
  const unique = new Set<string>();
  for (const part of raw.split(",")) {
    const hostname = normalizeHostnameInput(part);
    unique.add(hostname);
  }
  return Array.from(unique);
}
// [END: module]
