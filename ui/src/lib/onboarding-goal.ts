/**
 * FILE: ui/src/lib/onboarding-goal.ts
 * ABOUT: onboarding-goal.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - onboarding-goal.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: onboarding-goal.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/onboarding-goal.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function parseOnboardingGoalInput(raw: string): {
  title: string;
  description: string | null;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { title: "", description: null };
  }

  const [firstLine, ...restLines] = trimmed.split(/\r?\n/);
  const title = firstLine.trim();
  const description = restLines.join("\n").trim();

  return {
    title,
    description: description.length > 0 ? description : null,
  };
}
// [END: module]
