import { describe, expect, it } from "vitest";
import { CACHE_HIT_RATE_VOLUME_FLOOR, computeCacheHitRate } from "./cache-metrics.js";

describe("computeCacheHitRate", () => {
  it("reports insufficient data below the volume floor", () => {
    const result = computeCacheHitRate(900, 100);
    expect(result.rate).toBeNull();
    expect(result.band).toBe("insufficient_data");
    expect(result.totalInputTokens).toBe(1_000);
  });

  it("reports insufficient data when there is no input at all", () => {
    const result = computeCacheHitRate(0, 0);
    expect(result.rate).toBeNull();
    expect(result.band).toBe("insufficient_data");
  });

  it("divides cached by total input, not by fresh input", () => {
    const result = computeCacheHitRate(30_000, 70_000);
    expect(result.rate).toBeCloseTo(0.3, 5);
    expect(result.totalInputTokens).toBe(100_000);
  });

  it("bands idea 037's worked example of 31% as low", () => {
    expect(computeCacheHitRate(31_000, 69_000).band).toBe("low");
  });

  it("bands a mid rate as moderate and a high rate as good", () => {
    expect(computeCacheHitRate(50_000, 50_000).band).toBe("moderate");
    expect(computeCacheHitRate(80_000, 20_000).band).toBe("good");
  });

  it("treats the band thresholds as lower-inclusive", () => {
    expect(computeCacheHitRate(40_000, 60_000).band).toBe("moderate");
    expect(computeCacheHitRate(70_000, 30_000).band).toBe("good");
  });

  it("clamps negative inputs to zero", () => {
    const result = computeCacheHitRate(-5, -5);
    expect(result.totalInputTokens).toBe(0);
    expect(result.band).toBe("insufficient_data");
  });

  it("counts a rate of exactly 1 when everything is cached", () => {
    const result = computeCacheHitRate(CACHE_HIT_RATE_VOLUME_FLOOR, 0);
    expect(result.rate).toBe(1);
    expect(result.band).toBe("good");
  });
});
