/**
 * FILE: packages/shared/src/telemetry/index.ts
 * ABOUT: index.ts (telemetry module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (telemetry module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (telemetry module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/telemetry/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export { TelemetryClient } from "./client.js";
export { resolveTelemetryConfig } from "./config.js";
export { loadOrCreateState } from "./state.js";
export {
  trackInstallStarted,
  trackInstallCompleted,
  trackCompanyImported,
  trackProjectCreated,
  trackRoutineCreated,
  trackRoutineRun,
  trackGoalCreated,
  trackAgentCreated,
  trackSkillImported,
  trackAgentFirstHeartbeat,
  trackAgentTaskCompleted,
  trackErrorHandlerCrash,
} from "./events.js";
export type {
  TelemetryConfig,
  TelemetryState,
  TelemetryEvent,
  TelemetryEventEnvelope,
  TelemetryEventName,
} from "./types.js";
// [END: module]
