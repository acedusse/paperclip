/**
 * FILE: ui/src/api/instanceSettings.ts
 * ABOUT: instanceSettings.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - instanceSettings.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: instanceSettings.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/instanceSettings.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type {
  InstanceExperimentalSettings,
  InstanceGeneralSettings,
  InstanceSettings,
  IssueGraphLivenessAutoRecoveryPreview,
  PatchInstanceSettings,
  PatchInstanceGeneralSettings,
  PatchInstanceExperimentalSettings,
  RunExecutionState,
} from "@paperclipai/shared";
import { api } from "./client";

export type AdmissionStatus = {
  cap: number | null;
  source: string;
  running: number;
  queued: number;
  runExecutionState: RunExecutionState;
  breakerLevel: "normal" | "warn" | "throttle" | "halt";
};

export const instanceSettingsApi = {
  get: () =>
    api.get<InstanceSettings>("/instance/settings"),
  getAdmissionStatus: () =>
    api.get<AdmissionStatus>("/instance/admission-status"),
  setExecutionState: (state: RunExecutionState) =>
    api.post<AdmissionStatus>("/instance/execution-state", { state }),
  update: (patch: PatchInstanceSettings) =>
    api.patch<InstanceSettings>("/instance/settings", patch),
  getGeneral: () =>
    api.get<InstanceGeneralSettings>("/instance/settings/general"),
  updateGeneral: (patch: PatchInstanceGeneralSettings) =>
    api.patch<InstanceGeneralSettings>("/instance/settings/general", patch),
  getExperimental: () =>
    api.get<InstanceExperimentalSettings>("/instance/settings/experimental"),
  updateExperimental: (patch: PatchInstanceExperimentalSettings) =>
    api.patch<InstanceExperimentalSettings>("/instance/settings/experimental", patch),
  previewIssueGraphLivenessAutoRecovery: (input: { lookbackHours?: number }) =>
    api.post<IssueGraphLivenessAutoRecoveryPreview>(
      "/instance/settings/experimental/issue-graph-liveness-auto-recovery/preview",
      input,
    ),
  runIssueGraphLivenessAutoRecovery: (input: { lookbackHours?: number }) =>
    api.post<{
      findings: number;
      autoRecoveryEnabled: boolean;
      lookbackHours: number;
      cutoff: string;
      escalationsCreated: number;
      existingEscalations: number;
      skipped: number;
      skippedAutoRecoveryDisabled: number;
      skippedOutsideLookback: number;
      escalationIssueIds: string[];
    }>(
      "/instance/settings/experimental/issue-graph-liveness-auto-recovery/run",
      input,
    ),
};
// [END: module]
