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

  it("freezes the precedence array so it cannot be mutated at runtime", () => {
    expect(Object.isFrozen(CAP_WRITER_PRECEDENCE)).toBe(true);
    expect(() => {
      // @ts-expect-error runtime mutation attempt on a frozen readonly array
      CAP_WRITER_PRECEDENCE.push("rogue");
    }).toThrow();
  });

  it("returns the first non-null writer by precedence", () => {
    const writers: CapWriter[] = [
      { name: "configured-default", precedence: 4, resolve: () => 10 },
      { name: "manual-override", precedence: 2, resolve: () => 3 },
    ];
    const { cap, source } = resolveEffectiveCap({ configuredMax: 10 }, writers);
    expect(cap).toBe(3);
    expect(source).toBe("manual-override");
  });

  it("skips writers that return null (no opinion)", () => {
    const writers: CapWriter[] = [
      { name: "manual-override", precedence: 2, resolve: () => null },
      { name: "configured-default", precedence: 4, resolve: () => 7 },
    ];
    expect(resolveEffectiveCap({ configuredMax: 7 }, writers).cap).toBe(7);
  });

  it("yields unlimited (null) when no writer has an opinion", () => {
    const { cap, source } = resolveEffectiveCap({ configuredMax: null }, PHASE1_WRITERS);
    expect(cap).toBeNull();
    expect(source).toBe("none");
  });

  it("configured-default writer echoes the instance setting", () => {
    expect(configuredDefaultWriter.resolve({ configuredMax: 5 })).toBe(5);
    expect(configuredDefaultWriter.resolve({ configuredMax: null })).toBeNull();
  });
});
