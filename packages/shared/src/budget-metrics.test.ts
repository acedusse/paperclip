import { describe, expect, it } from "vitest";
import { BUDGET_METRICS, BUDGET_METRIC_META } from "./constants.js";

describe("BUDGET_METRIC_META", () => {
  it("covers every budget metric", () => {
    for (const metric of BUDGET_METRICS) {
      expect(BUDGET_METRIC_META[metric]).toBeDefined();
    }
    expect(Object.keys(BUDGET_METRIC_META).sort()).toEqual([...BUDGET_METRICS].sort());
  });

  it("scales cents by 100 because the operator types dollars", () => {
    expect(BUDGET_METRIC_META.billed_cents.inputScale).toBe(100);
    expect(BUDGET_METRIC_META.billed_cents.unit).toBe("cents");
  });

  it("scales tokens by 1 because the operator types tokens", () => {
    expect(BUDGET_METRIC_META.total_tokens.inputScale).toBe(1);
    expect(BUDGET_METRIC_META.total_tokens.unit).toBe("tokens");
  });

  it("gives every metric a positive raise increment", () => {
    for (const metric of BUDGET_METRICS) {
      expect(BUDGET_METRIC_META[metric].raiseIncrement).toBeGreaterThan(0);
    }
  });
});
