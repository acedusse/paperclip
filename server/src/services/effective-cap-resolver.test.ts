/**
 * FILE: server/src/services/effective-cap-resolver.test.ts
 * ABOUT: effective-cap-resolver.test.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - effective-cap-resolver.test.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: effective-cap-resolver.test.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/effective-cap-resolver.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  CAP_WRITER_PRECEDENCE,
  PHASE1_WRITERS,
  configuredDefaultWriter,
  panicDrainWriter,
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

describe("panicDrainWriter", () => {
  it("forces cap 0 when halted", () => {
    expect(panicDrainWriter.resolve({ configuredMax: 10, executionState: "halted" })).toBe(0);
  });
  it("forces cap 0 when draining", () => {
    expect(panicDrainWriter.resolve({ configuredMax: 10, executionState: "draining" })).toBe(0);
  });
  it("has no opinion when running", () => {
    expect(panicDrainWriter.resolve({ configuredMax: 10, executionState: "running" })).toBeNull();
  });
  it("has no opinion when state is absent", () => {
    expect(panicDrainWriter.resolve({ configuredMax: 10 })).toBeNull();
  });
  it("is registered at top precedence (index 0)", () => {
    expect(panicDrainWriter.precedence).toBe(CAP_WRITER_PRECEDENCE.indexOf("panic-drain"));
    expect(panicDrainWriter.precedence).toBe(0);
  });
  it("wins over configured-default when halted (resolveEffectiveCap)", () => {
    const { cap, source } = resolveEffectiveCap(
      { configuredMax: 10, executionState: "halted" },
      PHASE1_WRITERS,
    );
    expect(cap).toBe(0);
    expect(source).toBe("panic-drain");
  });
  it("falls through to configured-default when running", () => {
    const { cap, source } = resolveEffectiveCap(
      { configuredMax: 10, executionState: "running" },
      PHASE1_WRITERS,
    );
    expect(cap).toBe(10);
    expect(source).toBe("configured-default");
  });
});
// [END: module]
