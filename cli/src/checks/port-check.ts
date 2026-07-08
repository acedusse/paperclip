/**
 * FILE: cli/src/checks/port-check.ts
 * ABOUT: port-check.ts (checks module).
 *
 * SECTIONS:
 *   [TAG: module] - port-check.ts (checks module).
 */
// ==========================================
// [META: module]
// INTENT: port-check.ts (checks module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/checks/port-check.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { PaperclipConfig } from "../config/schema.js";
import { checkPort } from "../utils/net.js";
import type { CheckResult } from "./index.js";

export async function portCheck(config: PaperclipConfig): Promise<CheckResult> {
  const port = config.server.port;
  const result = await checkPort(port);

  if (result.available) {
    return {
      name: "Server port",
      status: "pass",
      message: `Port ${port} is available`,
    };
  }

  return {
    name: "Server port",
    status: "warn",
    message: result.error ?? `Port ${port} is not available`,
    canRepair: false,
    repairHint: `Check what's using port ${port} with: lsof -i :${port}`,
  };
}
// [END: module]
