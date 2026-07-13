/**
 * FILE: ui/src/api/runChangesets.ts
 * ABOUT: runChangesets.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - runChangesets.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: runChangesets.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/runChangesets.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { api } from "./client";

export type RunChangesetFile = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  oldPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
  truncated: boolean;
  diff?: string;
};
export type RunChangeset = {
  id: string;
  heartbeatRunId: string;
  baseRef: string | null;
  headRef: string | null;
  files: RunChangesetFile[];
  commands: { command: string; status: string; exitCode: number | null }[];
  summaryStats: { filesChanged: number; additions: number; deletions: number };
  warning: string | null;
};

export const runChangesetsApi = {
  get: (runId: string) => api.get<RunChangeset>(`/runs/${runId}/changeset`),
};
// [END: module]
