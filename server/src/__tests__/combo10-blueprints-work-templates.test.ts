/**
 * FILE: server/src/__tests__/combo10-blueprints-work-templates.test.ts
 * ABOUT: combo10-blueprints-work-templates.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - combo10-blueprints-work-templates.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: combo10-blueprints-work-templates.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/combo10-blueprints-work-templates.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import type { BlueprintManifest } from "@paperclipai/shared";
import {
  findUndeclaredPlaceholders,
  resolveBlueprintVariables,
  substituteBlueprintVariables,
} from "../services/blueprints/variables.ts";
import {
  applyWorkTemplate,
  evaluateDefinitionOfDone,
  getWorkTemplate,
  WORK_TEMPLATES,
} from "../services/work-templates/index.ts";

const manifest: BlueprintManifest = {
  key: "saas-startup",
  name: "SaaS startup",
  description: "A small product team",
  variables: [
    { key: "goal", label: "Company goal", type: "string" },
    { key: "budgetCents", label: "Monthly budget", type: "number", default: 50_000, min: 100, max: 1_000_000 },
    { key: "adapter", label: "Adapter", type: "choice", options: ["codex_local", "claude"], default: "claude" },
  ],
};

describe("resolveBlueprintVariables", () => {
  it("accepts a complete set of values", () => {
    const result = resolveBlueprintVariables(manifest, {
      goal: "Ship the beta",
      budgetCents: 20_000,
      adapter: "codex_local",
    });

    expect(result.issues).toEqual([]);
    expect(result.values).toEqual({ goal: "Ship the beta", budgetCents: 20_000, adapter: "codex_local" });
  });

  it("fills defaults for omitted variables", () => {
    const result = resolveBlueprintVariables(manifest, { goal: "Ship the beta" });

    expect(result.issues).toEqual([]);
    expect(result.values.budgetCents).toBe(50_000);
    expect(result.values.adapter).toBe("claude");
  });

  it("requires a variable that has no default", () => {
    const result = resolveBlueprintVariables(manifest, {});
    expect(result.issues.map((issue) => issue.variableKey)).toEqual(["goal"]);
  });

  it("treats an empty string as not supplied", () => {
    const result = resolveBlueprintVariables(manifest, { goal: "" });
    expect(result.issues[0]!.variableKey).toBe("goal");
  });

  it("reports every problem at once rather than stopping at the first", () => {
    // An operator filling six fields should not submit six times to find six
    // mistakes.
    const result = resolveBlueprintVariables(manifest, { budgetCents: "abc", adapter: "nope" });

    expect(result.issues.map((issue) => issue.variableKey).sort()).toEqual([
      "adapter",
      "budgetCents",
      "goal",
    ]);
  });

  it("coerces a numeric string", () => {
    const result = resolveBlueprintVariables(manifest, { goal: "g", budgetCents: "1234" });
    expect(result.values.budgetCents).toBe(1234);
  });

  it("enforces numeric bounds", () => {
    expect(
      resolveBlueprintVariables(manifest, { goal: "g", budgetCents: 1 }).issues[0]!.message,
    ).toContain("at least 100");
    expect(
      resolveBlueprintVariables(manifest, { goal: "g", budgetCents: 9_999_999 }).issues[0]!.message,
    ).toContain("at most 1000000");
  });

  it("rejects a choice outside the declared options", () => {
    const result = resolveBlueprintVariables(manifest, { goal: "g", adapter: "gpt" });
    expect(result.issues[0]!.message).toContain("must be one of");
  });

  it("reports an undeclared key instead of silently dropping it", () => {
    const result = resolveBlueprintVariables(manifest, { goal: "g", teamSize: 4 });
    expect(result.issues.map((issue) => issue.variableKey)).toEqual(["teamSize"]);
  });
});

describe("substituteBlueprintVariables", () => {
  const values = { goal: "Ship the beta", budgetCents: 20_000 };

  it("substitutes in strings", () => {
    expect(substituteBlueprintVariables("Goal: {{goal}}", values)).toBe("Goal: Ship the beta");
  });

  it("tolerates internal whitespace in the placeholder", () => {
    expect(substituteBlueprintVariables("{{ goal }}", values)).toBe("Ship the beta");
  });

  it("substitutes numbers as strings inside text", () => {
    expect(substituteBlueprintVariables("Budget {{budgetCents}}c", values)).toBe("Budget 20000c");
  });

  it("walks nested objects and arrays", () => {
    const template = { company: { name: "{{goal}}" }, agents: [{ title: "Lead on {{goal}}" }] };

    expect(substituteBlueprintVariables(template, values)).toEqual({
      company: { name: "Ship the beta" },
      agents: [{ title: "Lead on Ship the beta" }],
    });
  });

  it("substitutes object keys as well as values", () => {
    expect(substituteBlueprintVariables({ "{{goal}}": 1 }, values)).toEqual({ "Ship the beta": 1 });
  });

  it("leaves an unresolved placeholder verbatim rather than blanking it", () => {
    // A visible {{typo}} in the created company is far easier to diagnose than
    // a silently empty field.
    expect(substituteBlueprintVariables("{{typo}}", values)).toBe("{{typo}}");
  });

  it("leaves non-string leaves untouched", () => {
    expect(substituteBlueprintVariables({ n: 5, b: true, z: null }, values)).toEqual({
      n: 5,
      b: true,
      z: null,
    });
  });
});

describe("findUndeclaredPlaceholders", () => {
  it("finds nothing when the template only uses declared variables", () => {
    expect(findUndeclaredPlaceholders({ a: "{{goal}}" }, manifest)).toEqual([]);
  });

  it("reports a placeholder the manifest never declares", () => {
    expect(findUndeclaredPlaceholders({ a: "{{goal}} {{teamSize}}" }, manifest)).toEqual(["teamSize"]);
  });

  it("deduplicates and sorts", () => {
    const found = findUndeclaredPlaceholders(["{{z}}", "{{a}}", "{{z}}"], manifest);
    expect(found).toEqual(["a", "z"]);
  });

  it("looks inside object keys too", () => {
    expect(findUndeclaredPlaceholders({ "{{teamSize}}": 1 }, manifest)).toEqual(["teamSize"]);
  });
});

describe("work templates", () => {
  it("declares all four work kinds", () => {
    expect(Object.keys(WORK_TEMPLATES).sort()).toEqual(["bug", "content", "feature", "research"]);
  });

  it("gives every template acceptance criteria and a definition of done", () => {
    for (const template of Object.values(WORK_TEMPLATES)) {
      expect(template.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(template.definitionOfDone.length).toBeGreaterThan(0);
      expect(template.definitionOfDone.some((item) => item.required)).toBe(true);
    }
  });

  it("uses unique DoD keys within a template", () => {
    for (const template of Object.values(WORK_TEMPLATES)) {
      const keys = template.definitionOfDone.map((item) => item.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("returns null for an unknown kind", () => {
    expect(getWorkTemplate("nonsense")).toBeNull();
  });
});

describe("applyWorkTemplate", () => {
  it("seeds acceptance criteria onto a bare draft", () => {
    const draft = applyWorkTemplate({ title: "Add login" }, "feature");
    expect(draft.acceptanceCriteria).toEqual(WORK_TEMPLATES.feature.acceptanceCriteria);
  });

  it("does not overwrite criteria the operator already wrote", () => {
    const draft = applyWorkTemplate({ title: "Add login", acceptanceCriteria: ["Mine"] }, "feature");
    expect(draft.acceptanceCriteria).toEqual(["Mine"]);
  });

  it("returns the draft unchanged for an unknown kind", () => {
    const input = { title: "Add login" };
    expect(applyWorkTemplate(input, "nonsense")).toEqual(input);
  });

  it("copies the criteria rather than sharing the template array", () => {
    const draft = applyWorkTemplate({ title: "t" }, "bug");
    draft.acceptanceCriteria!.push("mutated");
    expect(WORK_TEMPLATES.bug.acceptanceCriteria).not.toContain("mutated");
  });
});

describe("evaluateDefinitionOfDone", () => {
  it("is unsatisfied when nothing is complete", () => {
    const result = evaluateDefinitionOfDone("feature", [])!;
    expect(result.satisfied).toBe(false);
    expect(result.missingRequired.length).toBeGreaterThan(0);
  });

  it("is satisfied once every required item is complete", () => {
    const required = WORK_TEMPLATES.feature.definitionOfDone
      .filter((item) => item.required)
      .map((item) => item.key);

    const result = evaluateDefinitionOfDone("feature", required)!;

    expect(result.satisfied).toBe(true);
    expect(result.missingRequired).toEqual([]);
  });

  it("reports advisory gaps without blocking", () => {
    const required = WORK_TEMPLATES.feature.definitionOfDone
      .filter((item) => item.required)
      .map((item) => item.key);

    const result = evaluateDefinitionOfDone("feature", required)!;

    expect(result.satisfied).toBe(true);
    expect(result.missingAdvisory.length).toBeGreaterThan(0);
  });

  it("ignores unknown completed keys", () => {
    const result = evaluateDefinitionOfDone("bug", ["not_a_real_item"])!;
    expect(result.satisfied).toBe(false);
  });

  it("returns null for an unknown kind", () => {
    expect(evaluateDefinitionOfDone("nonsense", [])).toBeNull();
  });
});
// [END: module]
