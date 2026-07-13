import { describe, expect, it, vi } from "vitest";
import { makePathClaimExpirySource } from "../services/workspace-path-claims.js";

describe("makePathClaimExpirySource", () => {
  it("expires each past-TTL claim and reports repaired counts", async () => {
    const expireClaim = vi.fn().mockResolvedValue(undefined);
    const src = makePathClaimExpirySource({
      findExpiredClaims: async () => [{ id: "c1" }, { id: "c2" }],
      expireClaim,
    });
    const result = await src.reconcile(new Date("2026-07-13T00:00:00.000Z"));
    expect(src.name).toBe("path-claim-expiry");
    expect(result).toEqual({ source: "path-claim-expiry", drifted: 2, repaired: 2 });
    expect(expireClaim).toHaveBeenCalledTimes(2);
  });
  it("returns zero without throwing when nothing is expired", async () => {
    const src = makePathClaimExpirySource({ findExpiredClaims: async () => [], expireClaim: vi.fn() });
    expect(await src.reconcile(new Date())).toEqual({ source: "path-claim-expiry", drifted: 0, repaired: 0 });
  });
});
