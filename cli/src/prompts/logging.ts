/**
 * FILE: cli/src/prompts/logging.ts
 * ABOUT: logging.ts (prompts module).
 *
 * SECTIONS:
 *   [TAG: module] - logging.ts (prompts module).
 */
// ==========================================
// [META: module]
// INTENT: logging.ts (prompts module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/prompts/logging.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import * as p from "@clack/prompts";
import type { LoggingConfig } from "../config/schema.js";
import { resolveDefaultLogsDir, resolvePaperclipInstanceId } from "../config/home.js";

export async function promptLogging(): Promise<LoggingConfig> {
  const defaultLogDir = resolveDefaultLogsDir(resolvePaperclipInstanceId());
  const mode = await p.select({
    message: "Logging mode",
    options: [
      { value: "file" as const, label: "File-based logging", hint: "recommended" },
      { value: "cloud" as const, label: "Cloud logging", hint: "coming soon" },
    ],
  });

  if (p.isCancel(mode)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  if (mode === "file") {
    const logDir = await p.text({
      message: "Log directory",
      defaultValue: defaultLogDir,
      placeholder: defaultLogDir,
    });

    if (p.isCancel(logDir)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    return { mode: "file", logDir: logDir || defaultLogDir };
  }

  p.note("Cloud logging is coming soon. Using file-based logging for now.");
  return { mode: "file", logDir: defaultLogDir };
}
// [END: module]
