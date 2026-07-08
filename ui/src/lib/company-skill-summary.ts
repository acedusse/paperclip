/**
 * FILE: ui/src/lib/company-skill-summary.ts
 * ABOUT: company-skill-summary.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - company-skill-summary.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: company-skill-summary.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/company-skill-summary.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
type SkillSummaryInput = {
  tagline?: string | null;
  description?: string | null;
  key?: string | null;
  name?: string | null;
};

function isStaleYamlBlockScalarIndicator(raw: string) {
  return /^[>|][+-]?$/.test(raw.trim());
}

export function sanitizeSkillSummaryText(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? "").trim();
  if (isStaleYamlBlockScalarIndicator(cleaned)) return null;
  return cleaned.length > 0 ? cleaned : null;
}

export function resolveSkillSummaryText(
  skill: SkillSummaryInput,
  options: { fallbackKey?: boolean } = {},
): string | null {
  const summary = sanitizeSkillSummaryText(skill.tagline) ?? sanitizeSkillSummaryText(skill.description);
  if (summary) return summary;

  if (options.fallbackKey) {
    const fallbackKey = skill.key?.trim();
    if (fallbackKey) return fallbackKey;
  }

  return null;
}
// [END: module]
