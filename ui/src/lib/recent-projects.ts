/**
 * FILE: ui/src/lib/recent-projects.ts
 * ABOUT: recent-projects.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - recent-projects.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: recent-projects.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/recent-projects.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import {
  readRecentSelectionIds,
  trackRecentSelectionId,
} from "./recent-selections";

const STORAGE_KEY = "paperclip:recent-projects";

export function getRecentProjectIds(): string[] {
  return readRecentSelectionIds(STORAGE_KEY);
}

export function trackRecentProject(projectId: string): void {
  trackRecentSelectionId(STORAGE_KEY, projectId);
}
// [END: module]
