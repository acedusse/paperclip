import { describe, expect, it, vi } from "vitest";
import {
  resolveEffectiveExecutionState,
  isQuiescing,
  makePanicHaltSweepSource,
} from "./run-execution-state.js";

describe("resolveEffectiveExecutionState", () => {
  it("takes the most-severe of instance and company", () => {
    expect(resolveEffectiveExecutionState("running", "running")).toBe("running");
    expect(resolveEffectiveExecutionState("running", "draining")).toBe("draining");
    expect(resolveEffectiveExecutionState("draining", "running")).toBe("draining");
    expect(resolveEffectiveExecutionState("halted", "running")).toBe("halted");
    expect(resolveEffectiveExecutionState("running", "halted")).toBe("halted");
    expect(resolveEffectiveExecutionState("draining", "halted")).toBe("halted");
  });
});

describe("isQuiescing", () => {
  it("is true for draining and halted, false for running", () => {
    expect(isQuiescing("running")).toBe(false);
    expect(isQuiescing("draining")).toBe(true);
    expect(isQuiescing("halted")).toBe(true);
  });
});

describe("makePanicHaltSweepSource", () => {
  it("winds down running runs in halted scopes with reason panic", async () => {
    const windDownRun = vi.fn(async () => ({ outcome: "terminated" as const }));
    const source = makePanicHaltSweepSource({
      findRunningRunsInHaltedScopes: vi.fn(async () => [{ id: "r1" }, { id: "r2" }]),
      windDownRun,
    });
    const result = await source.reconcile(new Date());
    expect(source.name).toBe("panic-halt-sweep");
    expect(windDownRun).toHaveBeenCalledTimes(2);
    expect(windDownRun).toHaveBeenCalledWith("r1", {
      mode: "hard",
      resume: "when-allowed",
      reason: "panic",
    });
    expect(result).toEqual({ source: "panic-halt-sweep", drifted: 2, repaired: 2 });
  });

  it("is a no-op when no halted scope has running runs", async () => {
    const windDownRun = vi.fn(async () => ({ outcome: "noop" as const }));
    const source = makePanicHaltSweepSource({
      findRunningRunsInHaltedScopes: vi.fn(async () => []),
      windDownRun,
    });
    const result = await source.reconcile(new Date());
    expect(windDownRun).not.toHaveBeenCalled();
    expect(result).toEqual({ source: "panic-halt-sweep", drifted: 0, repaired: 0 });
  });
});
