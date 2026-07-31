/**
 * FILE: server/src/services/company-preflight/projection.ts
 * ABOUT: Combo-10 Phase 4 — cost projection tier of the dry-run estimator (idea 004).
 *
 * SECTIONS:
 *   [TAG: module] - projection.ts (company-preflight module).
 */
// ==========================================
// [META: module]
// INTENT: Turn observed per-run cost into a projected band for the first N cycles.
// PSEUDOCODE: 1. Require history. 2. Band from percentiles. 3. Scale by agents and cycles.
// JSON_FLOW: {"file": "server/src/services/company-preflight/projection.ts", "imports": "none", "exports": "projectCost, CostProjection"}
// ==========================================
// [START: module]

export interface RunCostPercentiles {
  p10Cents: number;
  medianCents: number;
  p90Cents: number;
  sampleSize: number;
}

export interface CostProjection {
  /** Agents expected to run each cycle. */
  agentCount: number;
  cycles: number;
  lowCents: number;
  expectedCents: number;
  highCents: number;
  /** How much to trust the band. */
  confidence: "none" | "low" | "medium";
  basis: string;
}

/**
 * Below this many observed runs the percentiles are noise dressed up as a
 * forecast. The projection is still returned, but marked low-confidence and
 * labelled with the sample size so the number is never read as authoritative.
 */
const LOW_CONFIDENCE_SAMPLE = 20;

/**
 * Project spend for `cycles` heartbeats across `agentCount` agents.
 *
 * Returns `confidence: "none"` and a zero band when there is no history —
 * deliberately not a guess. Idea 004 calls for a "seeded default table" as a
 * cold-start fallback; inventing per-model prices here would produce a
 * confident-looking number derived from nothing, which is worse for the
 * operator than an honest "unknown".
 */
export function projectCost(
  percentiles: RunCostPercentiles | null,
  agentCount: number,
  cycles: number,
): CostProjection {
  if (!percentiles || percentiles.sampleSize === 0 || agentCount <= 0 || cycles <= 0) {
    return {
      agentCount: Math.max(0, agentCount),
      cycles: Math.max(0, cycles),
      lowCents: 0,
      expectedCents: 0,
      highCents: 0,
      confidence: "none",
      basis:
        percentiles && percentiles.sampleSize > 0
          ? "No agents or cycles to project."
          : "No cost history yet — run the company briefly, then check again.",
    };
  }

  const runs = agentCount * cycles;
  return {
    agentCount,
    cycles,
    lowCents: Math.round(percentiles.p10Cents * runs),
    expectedCents: Math.round(percentiles.medianCents * runs),
    highCents: Math.round(percentiles.p90Cents * runs),
    confidence: percentiles.sampleSize >= LOW_CONFIDENCE_SAMPLE ? "medium" : "low",
    basis: `Based on ${percentiles.sampleSize} observed run${percentiles.sampleSize === 1 ? "" : "s"} × ${agentCount} agent${agentCount === 1 ? "" : "s"} × ${cycles} cycle${cycles === 1 ? "" : "s"}.`,
  };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function describeProjection(projection: CostProjection): string {
  if (projection.confidence === "none") return projection.basis;
  return `${formatCents(projection.lowCents)}–${formatCents(projection.highCents)} (expect ~${formatCents(projection.expectedCents)}). ${projection.basis}`;
}
// [END: module]
