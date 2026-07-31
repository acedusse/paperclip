/**
 * FILE: server/src/services/demo-company/blueprint.ts
 * ABOUT: Combo-10 Phase 3 — the bundled runnable demo company (idea 039).
 *
 * SECTIONS:
 *   [TAG: module] - blueprint.ts (demo-company module).
 */
// ==========================================
// [META: module]
// INTENT: A parameterized demo company that costs ~nothing and needs no API key.
// PSEUDOCODE: 1. Declare variables. 2. Declare the org/goal/issue template.
// JSON_FLOW: {"file": "server/src/services/demo-company/blueprint.ts", "imports": "shared types", "exports": "DEMO_BLUEPRINT, DEMO_TEMPLATE"}
// ==========================================
// [START: module]
import type { BlueprintManifest } from "@paperclipai/shared";

/**
 * The demo is just the first entry in the blueprint library, not a special
 * case — it goes through the same variable resolution and substitution as any
 * other template, so the path the operator's real company takes is the path
 * the demo already exercised.
 */
export const DEMO_BLUEPRINT: BlueprintManifest = {
  key: "demo",
  name: "Demo company",
  description:
    "A small pre-built org with a goal and starter issues, so you can watch Paperclip work before committing your own.",
  category: "Getting started",
  variables: [
    {
      key: "companyName",
      label: "Company name",
      type: "string",
      default: "Demo Co",
      description: "Shown throughout the UI. Rename or delete this company whenever you like.",
    },
    {
      key: "goal",
      label: "Goal",
      type: "string",
      default: "Publish a one-page product brief",
      description: "The objective the demo org works toward.",
    },
    {
      key: "adapterType",
      label: "Adapter",
      type: "choice",
      // `process` needs no API key and no credentials, so the demo cannot
      // silently spend money. The combo calls for a free local model or a
      // stubbed adapter; no stub adapter exists yet, and `process` is the
      // closest thing that is genuinely zero-cost out of the box.
      default: "process",
      options: ["process", "claude_local", "codex_local", "opencode_local"],
      description: "Defaults to a local process so the demo costs nothing and needs no key.",
    },
    {
      key: "budgetCents",
      label: "Budget ceiling (cents)",
      type: "number",
      default: 500,
      min: 0,
      max: 100_000,
      description: "A deliberately small ceiling so a misconfigured demo cannot run away.",
    },
  ],
};

export interface DemoAgentSpec {
  name: string;
  role: string;
  title: string;
  /** Index into the spec list; null for the top of the org. */
  reportsToIndex: number | null;
}

export interface DemoIssueSpec {
  title: string;
  description: string;
  /** Which agent (by index) picks this up. */
  assigneeIndex: number;
  /** Work template kind, so the demo also demonstrates DoD. */
  templateKind: "feature" | "bug" | "content" | "research";
}

export interface DemoTemplate {
  companyName: string;
  goalTitle: string;
  budgetCents: string;
  adapterType: string;
  agents: DemoAgentSpec[];
  issues: DemoIssueSpec[];
}

/**
 * Placeholders here are resolved by `substituteBlueprintVariables`. Kept as a
 * plain data structure rather than inline company-creation calls so the
 * template can be validated (`findUndeclaredPlaceholders`) before anything is
 * written.
 */
export const DEMO_TEMPLATE: DemoTemplate = {
  companyName: "{{companyName}}",
  goalTitle: "{{goal}}",
  budgetCents: "{{budgetCents}}",
  adapterType: "{{adapterType}}",
  agents: [
    { name: "Ada", role: "ceo", title: "Chief Executive", reportsToIndex: null },
    { name: "Grace", role: "engineer", title: "Writer", reportsToIndex: 0 },
  ],
  issues: [
    {
      title: "Draft the outline for: {{goal}}",
      description: "Sketch the structure before writing. Keep it to five bullets.",
      assigneeIndex: 1,
      templateKind: "content",
    },
    {
      title: "Review the draft for: {{goal}}",
      description: "Check the draft against the acceptance criteria and leave notes.",
      assigneeIndex: 0,
      templateKind: "research",
    },
  ],
};
// [END: module]
