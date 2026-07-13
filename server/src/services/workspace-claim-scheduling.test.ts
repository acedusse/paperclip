import { describe, expect, it } from "vitest";
import { decideClaimScheduling } from "./workspace-claim-scheduling.ts";

const base = { enabled: true, isNewStart: true, activeClaimCount: 1, queuedForMs: 0, boundMs: 1000 };

describe("decideClaimScheduling", () => {
  it("admits when disabled even with contention", () => {
    expect(decideClaimScheduling({ ...base, enabled: false })).toBe("admit");
  });
  it("admits a continuation even with contention", () => {
    expect(decideClaimScheduling({ ...base, isNewStart: false })).toBe("admit");
  });
  it("admits a new start when there are no active claims", () => {
    expect(decideClaimScheduling({ ...base, activeClaimCount: 0 })).toBe("admit");
  });
  it("defers a new start under contention within the bound", () => {
    expect(decideClaimScheduling({ ...base, queuedForMs: 500 })).toBe("defer");
  });
  it("defers exactly at the bound (boundary is inclusive of defer)", () => {
    expect(decideClaimScheduling({ ...base, queuedForMs: 1000 })).toBe("defer");
  });
  it("admits despite contention once queued past the bound", () => {
    expect(decideClaimScheduling({ ...base, queuedForMs: 1001 })).toBe("admit_despite_claim");
  });
});
