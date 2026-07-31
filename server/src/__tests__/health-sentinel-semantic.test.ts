/**
 * FILE: server/src/__tests__/health-sentinel-semantic.test.ts
 * ABOUT: health-sentinel-semantic.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - health-sentinel-semantic.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: health-sentinel-semantic.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/health-sentinel-semantic.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  deterministicOverlapJudge,
  judgeDecompositionOverlap,
  titleSimilarity,
  type SemanticJudge,
} from "../services/health-sentinel/semantic.ts";

describe("titleSimilarity", () => {
  it("scores identical titles as 1", () => {
    expect(titleSimilarity("Add login form", "Add login form")).toBe(1);
  });

  it("scores unrelated titles as 0", () => {
    expect(titleSimilarity("Add login form", "Rotate database backups")).toBe(0);
  });

  it("ignores punctuation and case", () => {
    expect(titleSimilarity("Add login form", "add LOGIN form!!")).toBe(1);
  });

  it("drops tokens of two characters or fewer", () => {
    // "an" and "a" are noise; "the" is not filtered — see below.
    expect(titleSimilarity("Add login form", "Add an a login form")).toBe(1);
  });

  it("still counts short words like 'the' against similarity", () => {
    // Documents a real limit of the deterministic judge: it has no stop-word
    // list, so a filler word costs similarity. Above the default threshold
    // here, but it is why this tier is deliberately conservative.
    expect(titleSimilarity("Add login form", "Add the login form")).toBeCloseTo(0.75, 5);
  });

  it("scores partial overlap between 0 and 1", () => {
    const score = titleSimilarity("Add login form", "Add signup form");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 when a title has no scoreable tokens", () => {
    expect(titleSimilarity("a b c", "Add login form")).toBe(0);
  });
});

describe("judgeDecompositionOverlap", () => {
  const child = (issueId: string, title: string) => ({ issueId, title });

  it("finds nothing for distinct sub-issues", () => {
    const findings = judgeDecompositionOverlap("ACME-1", [
      child("a", "Add login form"),
      child("b", "Rotate database backups"),
    ]);
    expect(findings).toEqual([]);
  });

  it("flags near-identical sibling titles", () => {
    const findings = judgeDecompositionOverlap("ACME-1", [
      child("a", "Add login form"),
      child("b", "Add the login form"),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("decomposition_overlap");
    expect(findings[0]!.issueIds).toEqual(["a", "b"]);
    expect(findings[0]!.remediation).toContain("Merge or cancel");
  });

  it("suppresses judgments below the confidence threshold", () => {
    // "Add signup form" vs "Add login form" overlaps but not confidently.
    const findings = judgeDecompositionOverlap("ACME-1", [
      child("a", "Add login form"),
      child("b", "Add signup form"),
    ]);
    expect(findings).toEqual([]);
  });

  it("honours a lowered threshold", () => {
    const findings = judgeDecompositionOverlap(
      "ACME-1",
      [child("a", "Add login form"), child("b", "Add signup form")],
      deterministicOverlapJudge,
      0.4,
    );
    expect(findings).toHaveLength(1);
  });

  it("compares every pair, not just adjacent ones", () => {
    const findings = judgeDecompositionOverlap("ACME-1", [
      child("a", "Add login form"),
      child("b", "Rotate database backups"),
      child("c", "Add login form"),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.issueIds).toEqual(["a", "c"]);
  });

  it("treats a null judgment as no opinion, not a zero-confidence one", () => {
    const abstaining: SemanticJudge = { judgeSiblingOverlap: () => null };
    expect(
      judgeDecompositionOverlap(
        "ACME-1",
        [child("a", "Add login form"), child("b", "Add login form")],
        abstaining,
        0,
      ),
    ).toEqual([]);
  });

  it("accepts an injected judge — the seam a model tier plugs into", () => {
    const alwaysCertain: SemanticJudge = {
      judgeSiblingOverlap: () => ({ confidence: 1, reason: "model says so" }),
    };
    const findings = judgeDecompositionOverlap(
      "ACME-1",
      [child("a", "Add login form"), child("b", "Build authentication UI")],
      alwaysCertain,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.summary).toContain("model says so");
  });

  it("returns nothing for a single child", () => {
    expect(judgeDecompositionOverlap("ACME-1", [child("a", "Only one")])).toEqual([]);
  });
});
// [END: module]
