export type ClaimSchedulingDecision = "admit" | "defer" | "admit_despite_claim";

/**
 * Workspace-grain claim-aware selection decision (Combo 01, Phase 4B slice 3).
 * A queued run's subtree is unknown at selection time, so we reason only over
 * whether the run's shared workspace has any live claim from another run.
 * Applies to NEW STARTS only; continuations always admit. A new start held
 * longer than `boundMs` is admitted anyway (bounded-defer, no starvation).
 */
export function decideClaimScheduling(input: {
  enabled: boolean;
  isNewStart: boolean;
  activeClaimCount: number;
  queuedForMs: number;
  boundMs: number;
}): ClaimSchedulingDecision {
  if (!input.enabled) return "admit";
  if (!input.isNewStart) return "admit";
  if (input.activeClaimCount <= 0) return "admit";
  if (input.queuedForMs > input.boundMs) return "admit_despite_claim";
  return "defer";
}
