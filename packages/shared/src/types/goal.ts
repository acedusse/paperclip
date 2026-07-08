/**
 * FILE: packages/shared/src/types/goal.ts
 * ABOUT: goal.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - goal.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: goal.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/goal.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { GoalLevel, GoalStatus } from "../constants.js";

export interface Goal {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  parentId: string | null;
  ownerAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
// [END: module]
