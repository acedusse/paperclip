/**
 * FILE: packages/shared/src/types/adapter-skills.ts
 * ABOUT: adapter-skills.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - adapter-skills.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: adapter-skills.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/adapter-skills.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export type AgentSkillSyncMode = "unsupported" | "persistent" | "ephemeral";

export type AgentSkillState =
  | "available"
  | "configured"
  | "installed"
  | "missing"
  | "stale"
  | "external";

export type AgentSkillOrigin =
  | "company_managed"
  | "user_installed"
  | "external_unknown";

export interface AgentDesiredSkillEntry {
  key: string;
  versionId: string | null;
}

export interface AgentSkillEntry {
  key: string;
  runtimeName: string | null;
  versionId?: string | null;
  currentVersionId?: string | null;
  desired: boolean;
  managed: boolean;
  state: AgentSkillState;
  origin?: AgentSkillOrigin;
  originLabel?: string | null;
  locationLabel?: string | null;
  readOnly?: boolean;
  sourcePath?: string | null;
  targetPath?: string | null;
  detail?: string | null;
}

export interface AgentSkillSnapshot {
  adapterType: string;
  supported: boolean;
  mode: AgentSkillSyncMode;
  desiredSkills: string[];
  desiredSkillEntries?: AgentDesiredSkillEntry[];
  entries: AgentSkillEntry[];
  warnings: string[];
}

export interface AgentSkillSyncRequest {
  desiredSkills: Array<string | AgentDesiredSkillEntry>;
}
// [END: module]
