/**
 * FILE: packages/adapters/openclaw-gateway/src/cli/format-event.ts
 * ABOUT: format-event.ts (cli module).
 *
 * SECTIONS:
 *   [TAG: module] - format-event.ts (cli module).
 */
// ==========================================
// [META: module]
// INTENT: format-event.ts (cli module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapters/openclaw-gateway/src/cli/format-event.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import pc from "picocolors";

export function printOpenClawGatewayStreamEvent(raw: string, debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  if (!debug) {
    console.log(line);
    return;
  }

  if (line.startsWith("[openclaw-gateway:event]")) {
    console.log(pc.cyan(line));
    return;
  }

  if (line.startsWith("[openclaw-gateway]")) {
    console.log(pc.blue(line));
    return;
  }

  console.log(pc.gray(line));
}
// [END: module]
