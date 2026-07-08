/**
 * FILE: server/src/config-file.ts
 * ABOUT: config-file.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - config-file.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: config-file.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/config-file.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import fs from "node:fs";
import { paperclipConfigSchema, type PaperclipConfig } from "@paperclipai/shared";
import { resolvePaperclipConfigPath } from "./paths.js";

export function readConfigFile(): PaperclipConfig | null {
  const configPath = resolvePaperclipConfigPath();

  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return paperclipConfigSchema.parse(raw);
  } catch {
    return null;
  }
}
// [END: module]
