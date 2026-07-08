/**
 * FILE: server/src/telemetry.ts
 * ABOUT: telemetry.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - telemetry.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: telemetry.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/telemetry.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import path from "node:path";
import {
  TelemetryClient,
  resolveTelemetryConfig,
  loadOrCreateState,
} from "@paperclipai/shared/telemetry";
import { resolvePaperclipInstanceRoot } from "./home-paths.js";
import { serverVersion } from "./version.js";

let client: TelemetryClient | null = null;

export function initTelemetry(fileConfig?: { enabled?: boolean }): TelemetryClient | null {
  if (client) return client;

  const config = resolveTelemetryConfig(fileConfig);
  if (!config.enabled) return null;

  const stateDir = path.join(resolvePaperclipInstanceRoot(), "telemetry");
  client = new TelemetryClient(
    config,
    () => loadOrCreateState(stateDir, serverVersion),
    serverVersion,
  );
  client.startPeriodicFlush(60_000);
  return client;
}

export function getTelemetryClient(): TelemetryClient | null {
  return client;
}
// [END: module]
