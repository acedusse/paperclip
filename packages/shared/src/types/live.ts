/**
 * FILE: packages/shared/src/types/live.ts
 * ABOUT: live.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - live.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: live.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/live.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { LiveEventType } from "../constants.js";

export interface LiveEvent {
  id: number;
  companyId: string;
  type: LiveEventType;
  createdAt: string;
  payload: Record<string, unknown>;
}
// [END: module]
