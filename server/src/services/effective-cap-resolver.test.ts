import { describe, expect, it } from "vitest";
import {
  CAP_WRITER_PRECEDENCE,
  PHASE1_WRITERS,
  configuredDefaultWriter,
  resolveEffectiveCap,
  type CapWriter,
} from "./effective-cap-resolver.js";

describe("effective-cap-resolver", () => {
  it("locks the precedence order so future writers cannot reorder it", () => {
    expect(CAP_WRITER_PRECEDENCE).toEqual([
      "panic-drain",
      "predictive-breaker",
      "manual-override",
      "schedule",
      "configured-default",
    ]);
  });

  it("returns the first non-null writer by precedence", () => {
    const writers: CapWriter[] = [
      { name: "configured-default", precedence: 4, resolve: () => 10 },
      { name: "manual-override", precedence: 2, resolve: () => 3 },
    ];
    const { cap, source } = resolveEffectiveCap({ instanceMaxConcurrentRuns: 10 }, writers);
    expect(cap).toBe(3);
    expect(source).toBe("manual-override");
  });

  it("skips writers that return null (no opinion)", () => {
    const writers: CapWriter[] = [
      { name: "manual-override", precedence: 2, resolve: () => null },
      { name: "configured-default", precedence: 4, resolve: () => 7 },
    ];
    expect(resolveEffectiveCap({ instanceMaxConcurrentRuns: 7 }, writers).cap).toBe(7);
  });

  it("yields unlimited (null) when no writer has an opinion", () => {
    const { cap, source } = resolveEffectiveCap({ instanceMaxConcurrentRuns: null }, PHASE1_WRITERS);
    expect(cap).toBeNull();
    expect(source).toBe("none");
  });

  it("configured-default writer echoes the instance setting", () => {
    expect(configuredDefaultWriter.resolve({ instanceMaxConcurrentRuns: 5 })).toBe(5);
    expect(configuredDefaultWriter.resolve({ instanceMaxConcurrentRuns: null })).toBeNull();
  });
});
