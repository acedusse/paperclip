/**
 * FILE: packages/shared/src/telemetry/config.ts
 * ABOUT: config.ts (telemetry module).
 *
 * SECTIONS:
 *   [TAG: module] - config.ts (telemetry module).
 */
// ==========================================
// [META: module]
// INTENT: config.ts (telemetry module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/telemetry/config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { TelemetryConfig } from "./types.js";

const CI_ENV_VARS = ["CI", "CONTINUOUS_INTEGRATION", "BUILD_NUMBER", "GITHUB_ACTIONS", "GITLAB_CI"];

function isCI(): boolean {
  return CI_ENV_VARS.some((key) => process.env[key] === "true" || process.env[key] === "1");
}

export function resolveTelemetryConfig(fileConfig?: { enabled?: boolean }): TelemetryConfig {
  if (process.env.PAPERCLIP_TELEMETRY_DISABLED === "1") {
    return { enabled: false };
  }
  if (process.env.DO_NOT_TRACK === "1") {
    return { enabled: false };
  }
  if (isCI()) {
    return { enabled: false };
  }
  if (fileConfig?.enabled === false) {
    return { enabled: false };
  }

  const endpoint = process.env.PAPERCLIP_TELEMETRY_ENDPOINT || undefined;
  return { enabled: true, endpoint };
}
// [END: module]
