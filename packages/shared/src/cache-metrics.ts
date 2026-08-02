/**
 * FILE: packages/shared/src/cache-metrics.ts
 * ABOUT: cache-metrics.ts (shared module).
 *
 * SECTIONS:
 *   [TAG: module] - cache-metrics.ts (shared module).
 */
// ==========================================
// [META: module]
// INTENT: Derive prompt-cache efficiency from token counts already collected.
// PSEUDOCODE: 1. Clamp inputs. 2. Sum total input. 3. Band the ratio.
// JSON_FLOW: {"file": "packages/shared/src/cache-metrics.ts", "imports": "none", "exports": "computeCacheHitRate"}
// ==========================================
// [START: module]

/**
 * Minimum total input tokens before a cache-hit rate is meaningful. A 100% rate
 * off a single small run is noise, not a signal.
 */
export const CACHE_HIT_RATE_VOLUME_FLOOR = 10_000;

/**
 * Lower-inclusive band thresholds. These are a first-pass heuristic, not a measured
 * one — chosen so idea 037's own worked example (31%) reads as "low". They live here
 * so they can be retuned once there is real fleet data to calibrate against.
 */
export const CACHE_HIT_RATE_BANDS = { low: 0.4, moderate: 0.7 } as const;

export type CacheHitBand = "insufficient_data" | "low" | "moderate" | "good";

export interface CacheHitRateResult {
  /** cached / (cached + fresh input), or null below the volume floor */
  rate: number | null;
  band: CacheHitBand;
  totalInputTokens: number;
}

/**
 * Prompt-cache hit rate over a set of cost events.
 *
 * `inputTokens` in this schema is *fresh* (uncached) input, so the denominator is
 * the sum of both columns rather than `inputTokens` alone.
 */
export function computeCacheHitRate(cachedInputTokens: number, inputTokens: number): CacheHitRateResult {
  const cached = Number.isFinite(cachedInputTokens) ? Math.max(0, cachedInputTokens) : 0;
  const fresh = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const totalInputTokens = cached + fresh;

  if (totalInputTokens < CACHE_HIT_RATE_VOLUME_FLOOR) {
    return { rate: null, band: "insufficient_data", totalInputTokens };
  }

  const rate = cached / totalInputTokens;
  const band: CacheHitBand =
    rate < CACHE_HIT_RATE_BANDS.low ? "low" : rate < CACHE_HIT_RATE_BANDS.moderate ? "moderate" : "good";

  return { rate, band, totalInputTokens };
}
// [END: module]
