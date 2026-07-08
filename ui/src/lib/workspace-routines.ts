/**
 * FILE: ui/src/lib/workspace-routines.ts
 * ABOUT: workspace-routines.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - workspace-routines.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: workspace-routines.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/workspace-routines.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import {
  extractRoutineVariableNames,
  WORKSPACE_BRANCH_ROUTINE_VARIABLE,
  type RoutineListItem,
} from "@paperclipai/shared";

const WORKSPACE_SPECIFIC_ROUTINE_VARIABLES = new Set([
  WORKSPACE_BRANCH_ROUTINE_VARIABLE,
]);

export function getWorkspaceSpecificRoutineVariableNames(routine: RoutineListItem): string[] {
  const names = new Set<string>();

  for (const variable of routine.variables) {
    if (WORKSPACE_SPECIFIC_ROUTINE_VARIABLES.has(variable.name)) {
      names.add(variable.name);
    }
  }

  for (const name of extractRoutineVariableNames([routine.title, routine.description])) {
    if (WORKSPACE_SPECIFIC_ROUTINE_VARIABLES.has(name)) {
      names.add(name);
    }
  }

  return [...names];
}

export function routineHasWorkspaceSpecificVariables(routine: RoutineListItem): boolean {
  return getWorkspaceSpecificRoutineVariableNames(routine).length > 0;
}
// [END: module]
