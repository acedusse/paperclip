/**
 * FILE: server/src/__tests__/project-list-metrics.test.ts
 * ABOUT: project-list-metrics.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - project-list-metrics.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: project-list-metrics.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/project-list-metrics.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { buildProjectListMetricMaps } from "../services/projects.ts";

describe("buildProjectListMetricMaps", () => {
  it("maps task counts by project, coercing string counts to numbers", () => {
    const { taskCountByProjectId } = buildProjectListMetricMaps(
      [
        { projectId: "p1", count: 24 },
        { projectId: "p2", count: 11 as unknown as number },
      ],
      [],
    );

    expect(taskCountByProjectId.get("p1")).toBe(24);
    expect(taskCountByProjectId.get("p2")).toBe(11);
  });

  it("ignores task-count rows with a null project id", () => {
    const { taskCountByProjectId } = buildProjectListMetricMaps(
      [{ projectId: null, count: 5 }],
      [],
    );

    expect(taskCountByProjectId.size).toBe(0);
  });

  it("maps positive budgets with their window kind", () => {
    const { budgetByProjectId } = buildProjectListMetricMaps(
      [],
      [
        { scopeId: "p1", amount: 120_000, windowKind: "calendar_month_utc" },
        { scopeId: "p2", amount: 50_000, windowKind: "lifetime" },
      ],
    );

    expect(budgetByProjectId.get("p1")).toEqual({ amountCents: 120_000, windowKind: "calendar_month_utc" });
    expect(budgetByProjectId.get("p2")).toEqual({ amountCents: 50_000, windowKind: "lifetime" });
  });

  it("omits zero/negative budgets so they do not surface as 'set'", () => {
    const { budgetByProjectId } = buildProjectListMetricMaps(
      [],
      [
        { scopeId: "p1", amount: 0, windowKind: "lifetime" },
        { scopeId: "p2", amount: -10, windowKind: "lifetime" },
      ],
    );

    expect(budgetByProjectId.size).toBe(0);
  });
});
// [END: module]
