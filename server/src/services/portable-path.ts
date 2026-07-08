/**
 * FILE: server/src/services/portable-path.ts
 * ABOUT: portable-path.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - portable-path.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: portable-path.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/portable-path.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function normalizePortablePath(input: string) {
  const parts: string[] = [];
  for (const segment of input.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length > 0) parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}
// [END: module]
