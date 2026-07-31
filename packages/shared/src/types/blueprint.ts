/**
 * FILE: packages/shared/src/types/blueprint.ts
 * ABOUT: Combo-10 Phase 2 — parameterized company blueprints (idea 018).
 *
 * SECTIONS:
 *   [TAG: module] - blueprint.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: Declared variables over the portability format, so one template fits many companies.
// PSEUDOCODE: 1. Define variable kinds. 2. Define declarations. 3. Define manifest.
// JSON_FLOW: {"file": "packages/shared/src/types/blueprint.ts", "imports": "none", "exports": "BlueprintVariable, BlueprintManifest"}
// ==========================================
// [START: module]

export type BlueprintVariableType = "string" | "number" | "choice";

export interface BlueprintVariable {
  /** Referenced in the template as {{key}}. */
  key: string;
  label: string;
  type: BlueprintVariableType;
  description?: string;
  /** Used when the operator supplies nothing. A variable with no default is required. */
  default?: string | number;
  /** For `choice` — the permitted values. */
  options?: string[];
  /** For `number` — inclusive bounds. */
  min?: number;
  max?: number;
}

export interface BlueprintManifest {
  key: string;
  name: string;
  description: string;
  /** Free-text grouping, e.g. "SaaS startup", "content agency". */
  category?: string;
  variables: BlueprintVariable[];
}

export interface BlueprintValidationIssue {
  variableKey: string;
  message: string;
}

export interface BlueprintResolution {
  values: Record<string, string | number>;
  issues: BlueprintValidationIssue[];
}
// [END: module]
