/**
 * FILE: server/src/services/issue-liveness.ts
 * ABOUT: issue-liveness.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - issue-liveness.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: issue-liveness.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/issue-liveness.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export {
  classifyIssueGraphLiveness,
} from "./recovery/issue-graph-liveness.js";
export type {
  IssueGraphLivenessInput,
  IssueLivenessAgentInput,
  IssueLivenessDependencyPathEntry,
  IssueLivenessExecutionPathInput,
  IssueLivenessFinding,
  IssueLivenessIssueInput,
  IssueLivenessOwnerCandidate,
  IssueLivenessOwnerCandidateReason,
  IssueLivenessRelationInput,
  IssueLivenessSeverity,
  IssueLivenessState,
} from "./recovery/issue-graph-liveness.js";
// [END: module]
