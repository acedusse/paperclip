/**
 * FILE: cli/src/checks/config-check.ts
 * ABOUT: config-check.ts (checks module).
 *
 * SECTIONS:
 *   [TAG: module] - config-check.ts (checks module).
 */
// ==========================================
// [META: module]
// INTENT: config-check.ts (checks module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/checks/config-check.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { readConfig, configExists, resolveConfigPath } from "../config/store.js";
import type { CheckResult } from "./index.js";

export function configCheck(configPath?: string): CheckResult {
  const filePath = resolveConfigPath(configPath);

  if (!configExists(configPath)) {
    return {
      name: "Config file",
      status: "fail",
      message: `Config file not found at ${filePath}`,
      canRepair: false,
      repairHint: "Run `paperclipai onboard` to create one",
    };
  }

  try {
    readConfig(configPath);
    return {
      name: "Config file",
      status: "pass",
      message: `Valid config at ${filePath}`,
    };
  } catch (err) {
    return {
      name: "Config file",
      status: "fail",
      message: `Invalid config: ${err instanceof Error ? err.message : String(err)}`,
      canRepair: false,
      repairHint: "Run `paperclipai configure --section database` (or `paperclipai onboard` to recreate)",
    };
  }
}
// [END: module]
