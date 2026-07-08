/**
 * FILE: server/src/services/run-continuations.ts
 * ABOUT: run-continuations.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - run-continuations.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: run-continuations.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/run-continuations.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export {
  DEFAULT_MAX_LIVENESS_CONTINUATION_ATTEMPTS,
  RUN_LIVENESS_CONTINUATION_REASON,
  buildRunLivenessContinuationIdempotencyKey,
  decideRunLivenessContinuation,
  findExistingRunLivenessContinuationWake,
  readContinuationAttempt,
} from "./recovery/run-liveness-continuations.js";
export type {
  RunContinuationDecision,
} from "./recovery/run-liveness-continuations.js";
// [END: module]
