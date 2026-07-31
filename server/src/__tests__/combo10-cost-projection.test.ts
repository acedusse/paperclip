/**
 * FILE: server/src/__tests__/combo10-cost-projection.test.ts
 * ABOUT: combo10-cost-projection.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - combo10-cost-projection.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: combo10-cost-projection.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/combo10-cost-projection.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  describeProjection,
  formatCents,
  projectCost,
  type RunCostPercentiles,
} from "../services/company-preflight/projection.ts";

const percentiles = (overrides: Partial<RunCostPercentiles> = {}): RunCostPercentiles => ({
  p10Cents: 10,
  medianCents: 20,
  p90Cents: 50,
  sampleSize: 100,
  ...overrides,
});

describe("projectCost", () => {
  it("scales the band by agents and cycles", () => {
    const projection = projectCost(percentiles(), 3, 4);

    expect(projection.lowCents).toBe(10 * 12);
    expect(projection.expectedCents).toBe(20 * 12);
    expect(projection.highCents).toBe(50 * 12);
  });

  it("keeps low <= expected <= high", () => {
    const projection = projectCost(percentiles(), 2, 5);
    expect(projection.lowCents).toBeLessThanOrEqual(projection.expectedCents);
    expect(projection.expectedCents).toBeLessThanOrEqual(projection.highCents);
  });

  it("returns an honest unknown with no history rather than a guess", () => {
    // Inventing per-model prices would produce a confident-looking number
    // derived from nothing, which is worse for the operator than "unknown".
    const projection = projectCost(null, 3, 4);

    expect(projection.confidence).toBe("none");
    expect(projection.expectedCents).toBe(0);
    expect(projection.basis).toContain("No cost history");
  });

  it("treats a zero-sample percentile set as no history", () => {
    expect(projectCost(percentiles({ sampleSize: 0 }), 3, 4).confidence).toBe("none");
  });

  it("marks a thin sample as low confidence", () => {
    expect(projectCost(percentiles({ sampleSize: 5 }), 1, 1).confidence).toBe("low");
  });

  it("marks a healthy sample as medium confidence", () => {
    expect(projectCost(percentiles({ sampleSize: 100 }), 1, 1).confidence).toBe("medium");
  });

  it("never claims high confidence — this is a projection, not a quote", () => {
    const confidences = [1, 20, 10_000].map((sampleSize) =>
      projectCost(percentiles({ sampleSize }), 5, 5).confidence,
    );
    expect(confidences).not.toContain("high");
  });

  it("projects nothing when there are no agents", () => {
    const projection = projectCost(percentiles(), 0, 4);
    expect(projection.confidence).toBe("none");
    expect(projection.expectedCents).toBe(0);
  });

  it("projects nothing for zero cycles", () => {
    expect(projectCost(percentiles(), 3, 0).expectedCents).toBe(0);
  });

  it("states its basis so the number is auditable", () => {
    const projection = projectCost(percentiles({ sampleSize: 42 }), 3, 4);
    expect(projection.basis).toContain("42 observed runs");
    expect(projection.basis).toContain("3 agents");
    expect(projection.basis).toContain("4 cycles");
  });

  it("uses singular wording for a sample of one", () => {
    expect(projectCost(percentiles({ sampleSize: 1 }), 1, 1).basis).toContain("1 observed run ×");
  });
});

describe("formatCents", () => {
  it("renders whole dollars", () => {
    expect(formatCents(1000)).toBe("$10.00");
  });

  it("renders sub-dollar amounts", () => {
    expect(formatCents(5)).toBe("$0.05");
  });

  it("renders zero", () => {
    expect(formatCents(0)).toBe("$0.00");
  });
});

describe("describeProjection", () => {
  it("renders a band with the expected value", () => {
    const text = describeProjection(projectCost(percentiles(), 1, 1));
    expect(text).toContain("$0.10–$0.50");
    expect(text).toContain("expect ~$0.20");
  });

  it("falls back to the basis when there is nothing to project", () => {
    expect(describeProjection(projectCost(null, 1, 1))).toContain("No cost history");
  });
});
// [END: module]
