/**
 * FILE: ui/src/lib/org-heat.test.ts
 * ABOUT: org-heat.test.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - org-heat.test.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: org-heat.test.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/org-heat.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import type { AgentHeat } from "@paperclipai/shared";
import { heatStyleFor, heatTooltip } from "./org-heat";

const heat = (overrides: Partial<AgentHeat>): AgentHeat => ({
  agentId: "a1",
  blockedScore: 0,
  driftScore: 0,
  reasons: [],
  ...overrides,
});

describe("heatStyleFor", () => {
  it("returns no styling for an agent with no heat entry", () => {
    expect(heatStyleFor(undefined)).toEqual({ kind: "none", intensity: "none", className: "" });
  });

  it("returns no styling for a zero-score entry", () => {
    expect(heatStyleFor(heat({})).kind).toBe("none");
  });

  it("marks a lightly blocked agent as low blocked heat", () => {
    const style = heatStyleFor(heat({ blockedScore: 1 }));
    expect(style.kind).toBe("blocked");
    expect(style.intensity).toBe("low");
    expect(style.className).toContain("amber");
  });

  it("marks a heavily blocked agent as high blocked heat", () => {
    const style = heatStyleFor(heat({ blockedScore: 4 }));
    expect(style.intensity).toBe("high");
    expect(style.className).toContain("red");
  });

  it("marks a drifting agent with cool colours, distinct from blocked", () => {
    const style = heatStyleFor(heat({ driftScore: 1 }));
    expect(style.kind).toBe("drift");
    expect(style.className).toContain("sky");
  });

  it("breaks a tie toward blocked, the more urgent read", () => {
    expect(heatStyleFor(heat({ blockedScore: 2, driftScore: 2 })).kind).toBe("blocked");
  });

  it("picks the dominant pressure when they differ", () => {
    expect(heatStyleFor(heat({ blockedScore: 1, driftScore: 3 })).kind).toBe("drift");
  });

  it("uses the combined score for intensity, not just the dominant channel", () => {
    // Neither channel alone reaches the threshold, but together they do.
    const style = heatStyleFor(heat({ blockedScore: 2, driftScore: 2 }));
    expect(style.intensity).toBe("high");
  });
});

describe("heatTooltip", () => {
  it("is empty when there is nothing to say", () => {
    expect(heatTooltip(undefined)).toBe("");
    expect(heatTooltip(heat({}))).toBe("");
  });

  it("renders readable labels for each reason", () => {
    const tooltip = heatTooltip(heat({ reasons: ["blocker_cycle", "orphan_issue"] }));
    expect(tooltip).toBe("in a blocking cycle; work not linked to a live goal");
  });

  it("covers every finding kind with a label", () => {
    const allKinds: AgentHeat["reasons"] = [
      "blocker_cycle",
      "blocked_dead_end",
      "orphan_issue",
      "goal_without_work",
      "decomposition_incomplete",
      "agent_error_budget_burned",
    ];
    const tooltip = heatTooltip(heat({ reasons: allKinds }));
    // A missing label would leak the raw snake_case kind into the UI.
    expect(tooltip).not.toContain("_");
  });
});
// [END: module]
