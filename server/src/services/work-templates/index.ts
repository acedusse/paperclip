/**
 * FILE: server/src/services/work-templates/index.ts
 * ABOUT: Combo-10 Phase 2 — work templates and definition-of-done (idea 058).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (work-templates module).
 */
// ==========================================
// [META: module]
// INTENT: Give each work type a consistent acceptance bar that travels with blueprints.
// PSEUDOCODE: 1. Declare templates. 2. Apply to an issue draft. 3. Evaluate DoD.
// JSON_FLOW: {"file": "server/src/services/work-templates/index.ts", "imports": "none", "exports": "WORK_TEMPLATES, applyWorkTemplate, evaluateDefinitionOfDone"}
// ==========================================
// [START: module]

export type WorkTemplateKind = "feature" | "bug" | "content" | "research";

export interface DefinitionOfDoneItem {
  key: string;
  label: string;
  /**
   * When false the item is advisory — the review gate reports it but does not
   * block on it. Keeps the checklist honest instead of encouraging operators
   * to wave through a list of mandatory items that do not always apply.
   */
  required: boolean;
}

export interface WorkTemplate {
  kind: WorkTemplateKind;
  label: string;
  /** Seeded onto the issue so work starts with a consistent shape. */
  acceptanceCriteria: string[];
  definitionOfDone: DefinitionOfDoneItem[];
}

const FEATURE: WorkTemplate = {
  kind: "feature",
  label: "Feature",
  acceptanceCriteria: [
    "The described behaviour works end to end for the primary case",
    "Edge cases and failure paths behave predictably",
    "The change is covered by automated tests",
  ],
  definitionOfDone: [
    { key: "tests_pass", label: "Automated tests pass", required: true },
    { key: "tests_added", label: "New behaviour has test coverage", required: true },
    { key: "no_debug_code", label: "No debug or commented-out code left behind", required: true },
    { key: "docs_updated", label: "User-facing docs updated if behaviour changed", required: false },
  ],
};

const BUG: WorkTemplate = {
  kind: "bug",
  label: "Bug",
  acceptanceCriteria: [
    "The reported symptom no longer reproduces",
    "The root cause is identified, not just the symptom suppressed",
  ],
  definitionOfDone: [
    { key: "reproduced", label: "The bug was reproduced before fixing", required: true },
    { key: "regression_test", label: "A regression test covers the fix", required: true },
    { key: "tests_pass", label: "Automated tests pass", required: true },
    { key: "root_cause_stated", label: "Root cause recorded on the issue", required: false },
  ],
};

const CONTENT: WorkTemplate = {
  kind: "content",
  label: "Content",
  acceptanceCriteria: [
    "The piece covers the requested topic and audience",
    "Claims are supported and sources cited where needed",
  ],
  definitionOfDone: [
    { key: "proofread", label: "Proofread for spelling and grammar", required: true },
    { key: "facts_checked", label: "Factual claims verified", required: true },
    { key: "tone_matches", label: "Tone matches the brief", required: false },
  ],
};

const RESEARCH: WorkTemplate = {
  kind: "research",
  label: "Research",
  acceptanceCriteria: [
    "The question posed is answered, or explicitly reported as unanswerable",
    "Findings distinguish evidence from inference",
  ],
  definitionOfDone: [
    { key: "sources_listed", label: "Sources listed and reachable", required: true },
    { key: "answer_stated", label: "A direct answer is stated up front", required: true },
    { key: "limits_stated", label: "Limits and open questions recorded", required: false },
  ],
};

export const WORK_TEMPLATES: Record<WorkTemplateKind, WorkTemplate> = {
  feature: FEATURE,
  bug: BUG,
  content: CONTENT,
  research: RESEARCH,
};

export function getWorkTemplate(kind: string): WorkTemplate | null {
  return WORK_TEMPLATES[kind as WorkTemplateKind] ?? null;
}

export interface IssueDraft {
  title: string;
  description?: string | null;
  acceptanceCriteria?: string[];
}

/**
 * Seed a draft issue from a template.
 *
 * Operator-supplied criteria win: the template is a starting point, not an
 * override. Applying a template to an issue that already states its own
 * acceptance criteria must not silently replace them.
 */
export function applyWorkTemplate(draft: IssueDraft, kind: string): IssueDraft {
  const template = getWorkTemplate(kind);
  if (!template) return draft;

  const existing = draft.acceptanceCriteria ?? [];
  if (existing.length > 0) return draft;

  return { ...draft, acceptanceCriteria: [...template.acceptanceCriteria] };
}

export interface DefinitionOfDoneResult {
  kind: WorkTemplateKind;
  satisfied: boolean;
  missingRequired: DefinitionOfDoneItem[];
  missingAdvisory: DefinitionOfDoneItem[];
}

/**
 * Evaluate a DoD checklist against the items an agent reported complete.
 * This is what combo-05's review gate consumes as its concrete bar.
 */
export function evaluateDefinitionOfDone(
  kind: string,
  completedKeys: string[],
): DefinitionOfDoneResult | null {
  const template = getWorkTemplate(kind);
  if (!template) return null;

  const completed = new Set(completedKeys);
  const missingRequired = template.definitionOfDone.filter(
    (item) => item.required && !completed.has(item.key),
  );
  const missingAdvisory = template.definitionOfDone.filter(
    (item) => !item.required && !completed.has(item.key),
  );

  return {
    kind: template.kind,
    satisfied: missingRequired.length === 0,
    missingRequired,
    missingAdvisory,
  };
}
// [END: module]
