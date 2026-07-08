/**
 * FILE: packages/shared/src/types/activity.ts
 * ABOUT: activity.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - activity.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: activity.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/activity.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export interface ActivityEvent {
  id: string;
  companyId: string;
  actorType: "agent" | "user" | "system" | "plugin";
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  agentId: string | null;
  runId: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
}
// [END: module]
