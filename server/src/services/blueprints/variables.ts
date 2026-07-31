/**
 * FILE: server/src/services/blueprints/variables.ts
 * ABOUT: Combo-10 Phase 2 — blueprint variable resolution and substitution (idea 018).
 *
 * SECTIONS:
 *   [TAG: module] - variables.ts (blueprints module).
 */
// ==========================================
// [META: module]
// INTENT: Validate operator input against declared variables, then substitute into a template.
// PSEUDOCODE: 1. Coerce + validate per declaration. 2. Fill defaults. 3. Substitute {{key}}.
// JSON_FLOW: {"file": "server/src/services/blueprints/variables.ts", "imports": "shared types", "exports": "resolveBlueprintVariables, substituteBlueprintVariables"}
// ==========================================
// [START: module]
import type {
  BlueprintManifest,
  BlueprintResolution,
  BlueprintValidationIssue,
  BlueprintVariable,
} from "@paperclipai/shared";

/** `{{key}}`, tolerating internal whitespace: `{{ key }}`. */
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function validateOne(
  variable: BlueprintVariable,
  raw: unknown,
): { value?: string | number; issue?: BlueprintValidationIssue } {
  const supplied = raw !== undefined && raw !== null && raw !== "";

  if (!supplied) {
    if (variable.default !== undefined) return { value: variable.default };
    return {
      issue: { variableKey: variable.key, message: `"${variable.label}" is required.` },
    };
  }

  if (variable.type === "number") {
    const numeric = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(numeric)) {
      return { issue: { variableKey: variable.key, message: `"${variable.label}" must be a number.` } };
    }
    if (variable.min !== undefined && numeric < variable.min) {
      return {
        issue: { variableKey: variable.key, message: `"${variable.label}" must be at least ${variable.min}.` },
      };
    }
    if (variable.max !== undefined && numeric > variable.max) {
      return {
        issue: { variableKey: variable.key, message: `"${variable.label}" must be at most ${variable.max}.` },
      };
    }
    return { value: numeric };
  }

  const text = String(raw);

  if (variable.type === "choice") {
    const options = variable.options ?? [];
    if (!options.includes(text)) {
      return {
        issue: {
          variableKey: variable.key,
          message: `"${variable.label}" must be one of: ${options.join(", ")}.`,
        },
      };
    }
  }

  return { value: text };
}

/**
 * Validate supplied values against the manifest, filling defaults.
 *
 * Returns issues rather than throwing so the wizard can show every problem at
 * once — an operator filling six fields should not have to submit six times to
 * discover six mistakes.
 */
export function resolveBlueprintVariables(
  manifest: BlueprintManifest,
  supplied: Record<string, unknown>,
): BlueprintResolution {
  const values: Record<string, string | number> = {};
  const issues: BlueprintValidationIssue[] = [];

  for (const variable of manifest.variables) {
    const { value, issue } = validateOne(variable, supplied[variable.key]);
    if (issue) issues.push(issue);
    else if (value !== undefined) values[variable.key] = value;
  }

  // Unknown keys are reported rather than ignored: silently dropping one is
  // how an operator ends up wondering why their setting had no effect.
  const declared = new Set(manifest.variables.map((variable) => variable.key));
  for (const key of Object.keys(supplied)) {
    if (declared.has(key)) continue;
    issues.push({ variableKey: key, message: `"${key}" is not a variable of this blueprint.` });
  }

  return { values, issues };
}

/**
 * Replace every `{{key}}` in a template tree with its resolved value.
 *
 * Walks strings, arrays and plain objects. Object *keys* are substituted too,
 * so a blueprint can parameterize a map entry and not just its value.
 */
export function substituteBlueprintVariables<T>(template: T, values: Record<string, string | number>): T {
  return substituteValue(template, values) as T;
}

function substituteString(input: string, values: Record<string, string | number>): string {
  return input.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    const value = values[key];
    // An unresolved placeholder is left verbatim rather than blanked: a
    // visible {{typo}} in the created company is far easier to diagnose than
    // a silently empty field.
    return value === undefined ? match : String(value);
  });
}

function substituteValue(input: unknown, values: Record<string, string | number>): unknown {
  if (typeof input === "string") return substituteString(input, values);
  if (Array.isArray(input)) return input.map((entry) => substituteValue(entry, values));
  if (input !== null && typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      result[substituteString(key, values)] = substituteValue(value, values);
    }
    return result;
  }
  return input;
}

/** Placeholders present in the template but not declared by the manifest. */
export function findUndeclaredPlaceholders(template: unknown, manifest: BlueprintManifest): string[] {
  const declared = new Set(manifest.variables.map((variable) => variable.key));
  const found = new Set<string>();

  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      for (const match of node.matchAll(PLACEHOLDER_PATTERN)) {
        const key = match[1]!;
        if (!declared.has(key)) found.add(key);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        walk(key);
        walk(value);
      }
    }
  };

  walk(template);
  return [...found].sort();
}
// [END: module]
