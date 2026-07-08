/**
 * FILE: ui/src/lib/project-budget-format.test.ts
 * ABOUT: project-budget-format.test.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - project-budget-format.test.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: project-budget-format.test.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/project-budget-format.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { formatProjectBudget } from "./utils";

describe("formatProjectBudget", () => {
  it("renders a /mo suffix for monthly budgets", () => {
    expect(formatProjectBudget({ amountCents: 120_000, windowKind: "calendar_month_utc" })).toBe("$1,200.00/mo");
  });

  it("renders the bare amount for lifetime budgets", () => {
    expect(formatProjectBudget({ amountCents: 50_000, windowKind: "lifetime" })).toBe("$500.00");
  });

  it("formats sub-dollar amounts with cents", () => {
    expect(formatProjectBudget({ amountCents: 150, windowKind: "lifetime" })).toBe("$1.50");
  });
});
// [END: module]
