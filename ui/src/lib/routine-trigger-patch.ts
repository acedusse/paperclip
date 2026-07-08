/**
 * FILE: ui/src/lib/routine-trigger-patch.ts
 * ABOUT: routine-trigger-patch.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - routine-trigger-patch.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: routine-trigger-patch.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/routine-trigger-patch.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { RoutineTrigger } from "@paperclipai/shared";

export type RoutineTriggerEditorDraft = {
  label: string;
  cronExpression: string;
  signingMode: string;
  replayWindowSec: string;
};

export function buildRoutineTriggerPatch(
  trigger: RoutineTrigger,
  draft: RoutineTriggerEditorDraft,
  fallbackTimezone: string,
) {
  const patch: Record<string, unknown> = {
    label: draft.label.trim() || null,
  };

  if (trigger.kind === "schedule") {
    patch.cronExpression = draft.cronExpression.trim();
    patch.timezone = trigger.timezone ?? fallbackTimezone;
  }

  if (trigger.kind === "webhook") {
    patch.signingMode = draft.signingMode;
    patch.replayWindowSec = Number(draft.replayWindowSec || "300");
  }

  return patch;
}
// [END: module]
