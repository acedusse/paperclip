/**
 * FILE: ui/src/lib/org-heat.ts
 * ABOUT: Idea 006 — map Health Sentinel agent heat to org-chart node styling.
 *
 * SECTIONS:
 *   [TAG: module] - org-heat.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: Turn per-agent pressure scores into a ring colour and tooltip.
// PSEUDOCODE: 1. Pick dominant pressure. 2. Bucket intensity. 3. Emit style.
// JSON_FLOW: {"file": "ui/src/lib/org-heat.ts", "imports": "shared types", "exports": "heatStyleFor, heatTooltip"}
// ==========================================
// [START: module]
import type { AgentHeat, HealthFindingKind } from "@paperclipai/shared";

export type HeatKind = "none" | "blocked" | "drift";
export type HeatIntensity = "none" | "low" | "high";

export interface HeatStyle {
  kind: HeatKind;
  intensity: HeatIntensity;
  /** Tailwind ring classes, or "" when the node has no pressure. */
  className: string;
}

/** Above this combined score a node reads as seriously in trouble, not merely warm. */
const HIGH_INTENSITY_THRESHOLD = 3;

const HEAT_CLASSES: Record<Exclude<HeatKind, "none">, Record<Exclude<HeatIntensity, "none">, string>> = {
  // Hot = jammed. Warm colours.
  blocked: {
    low: "ring-2 ring-amber-400/60",
    high: "ring-2 ring-red-500/70",
  },
  // Cold = adrift. Cool colours, so the two pressures stay visually distinct
  // for someone scanning the chart rather than reading tooltips.
  drift: {
    low: "ring-2 ring-sky-400/50",
    high: "ring-2 ring-indigo-500/70",
  },
};

export function heatStyleFor(heat: AgentHeat | undefined): HeatStyle {
  if (!heat) return { kind: "none", intensity: "none", className: "" };

  const total = heat.blockedScore + heat.driftScore;
  if (total <= 0) return { kind: "none", intensity: "none", className: "" };

  // Ties go to "blocked": a jammed agent is the more urgent read, and showing
  // it as drift would point the operator at the wrong fix.
  const kind: Exclude<HeatKind, "none"> = heat.blockedScore >= heat.driftScore ? "blocked" : "drift";
  const intensity: Exclude<HeatIntensity, "none"> =
    total >= HIGH_INTENSITY_THRESHOLD ? "high" : "low";

  return { kind, intensity, className: HEAT_CLASSES[kind][intensity] };
}

const REASON_LABELS: Record<HealthFindingKind, string> = {
  blocker_cycle: "in a blocking cycle",
  blocked_dead_end: "blocked by a cancelled issue",
  orphan_issue: "work not linked to a live goal",
  goal_without_work: "goal with no open work",
  decomposition_incomplete: "incomplete plan decomposition",
  decomposition_overlap: "duplicated sub-issues",
  agent_error_budget_burned: "over its error budget",
};

export function heatTooltip(heat: AgentHeat | undefined): string {
  if (!heat || heat.reasons.length === 0) return "";
  return heat.reasons.map((reason) => REASON_LABELS[reason] ?? reason).join("; ");
}
// [END: module]
