/**
 * FILE: ui/src/lib/workspace-routines.test.ts
 * ABOUT: workspace-routines.test.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - workspace-routines.test.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: workspace-routines.test.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/workspace-routines.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { RoutineListItem } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  getWorkspaceSpecificRoutineVariableNames,
  routineHasWorkspaceSpecificVariables,
} from "./workspace-routines";

function createRoutine(overrides: Partial<RoutineListItem> = {}): RoutineListItem {
  return {
    id: "routine-1",
    companyId: "company-1",
    projectId: "project-1",
    goalId: null,
    parentIssueId: null,
    title: "Routine title",
    description: null,
    assigneeAgentId: "agent-1",
    priority: "medium",
    status: "active",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    variables: [],
    latestRevisionId: null,
    latestRevisionNumber: 1,
    createdByAgentId: null,
    createdByUserId: null,
    updatedByAgentId: null,
    updatedByUserId: null,
    lastTriggeredAt: null,
    lastEnqueuedAt: null,
    createdAt: new Date("2026-04-30T00:00:00.000Z"),
    updatedAt: new Date("2026-04-30T00:00:00.000Z"),
    triggers: [],
    lastRun: null,
    activeIssue: null,
    ...overrides,
  };
}

describe("workspace routine helpers", () => {
  it("matches routines with explicit workspace variables", () => {
    const routine = createRoutine({
      variables: [
        { name: "workspaceBranch", label: null, type: "text", defaultValue: null, required: true, options: [] },
      ],
    });

    expect(routineHasWorkspaceSpecificVariables(routine)).toBe(true);
    expect(getWorkspaceSpecificRoutineVariableNames(routine)).toEqual(["workspaceBranch"]);
  });

  it("matches routines that reference workspace variables in templates", () => {
    const routine = createRoutine({
      title: "Review {{ workspaceBranch }}",
      description: "Check branch {{workspaceBranch}}",
    });

    expect(getWorkspaceSpecificRoutineVariableNames(routine)).toEqual(["workspaceBranch"]);
  });

  it("ignores routines with only non-workspace variables", () => {
    const routine = createRoutine({
      title: "Review {{repo}}",
      variables: [
        { name: "repo", label: null, type: "text", defaultValue: null, required: true, options: [] },
      ],
    });

    expect(routineHasWorkspaceSpecificVariables(routine)).toBe(false);
  });
});
// [END: module]
