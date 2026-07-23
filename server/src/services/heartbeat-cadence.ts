import { idleBackoffSchema, PRODUCTIVE_RUN_LIVENESS_STATES, type IdleBackoffConfig, type RunLivenessState } from "@paperclipai/shared";

/**
 * Effective timer interval for an agent given its idle streak. Grows
 * geometrically while idle, capped at maxIntervalSec, and never drops below
 * the configured base (defensive against a misconfigured cap < base).
 */
export function effectiveIntervalSec(baseSec: number, streak: number, cfg: IdleBackoffConfig): number {
  if (!cfg.enabled) return baseSec;
  const grown = baseSec * cfg.multiplier ** Math.max(0, streak);
  const cap = Math.max(baseSec, cfg.maxIntervalSec);
  return Math.min(grown, cap);
}

/**
 * Whether an idle-streak change moves the agent's *effective* interval, and
 * which way. `changed` is false when the interval is unchanged (streak grew
 * but already pinned at the cap, no streak change, or backoff disabled) — the
 * caller uses this to emit a cadence-transition audit only on real transitions.
 * `direction` is only meaningful when `changed` is true.
 */
export function cadenceTransition(
  baseSec: number,
  oldStreak: number,
  newStreak: number,
  cfg: IdleBackoffConfig,
): { changed: boolean; direction: "backoff" | "reset"; oldIntervalSec: number; newIntervalSec: number } {
  const oldIntervalSec = effectiveIntervalSec(baseSec, oldStreak, cfg);
  const newIntervalSec = effectiveIntervalSec(baseSec, newStreak, cfg);
  return {
    changed: newIntervalSec !== oldIntervalSec,
    direction: newIntervalSec > oldIntervalSec ? "backoff" : "reset",
    oldIntervalSec,
    newIntervalSec,
  };
}

/** Parse just the fields idle-backoff needs from an agent's runtimeConfig blob. */
export function parseHeartbeatCadenceConfig(runtimeConfig: unknown): { intervalSec: number; idleBackoff: IdleBackoffConfig } {
  const hb = (runtimeConfig as { heartbeat?: Record<string, unknown> } | null)?.heartbeat ?? {};
  const intervalSec = typeof hb.intervalSec === "number" && hb.intervalSec > 0 ? hb.intervalSec : 0;
  return { intervalSec, idleBackoff: idleBackoffSchema.parse(hb.idleBackoff ?? {}) };
}

/** Increment on an empty heartbeat, otherwise reset to 0. */
export function nextIdleStreak(currentStreak: number, isEmpty: boolean): number {
  return isEmpty ? currentStreak + 1 : 0;
}

/**
 * An "empty heartbeat" is a timer-driven wake that succeeded without making
 * concrete progress. Failures and event-driven wakes are never empty (they
 * reset the streak). "No concrete progress" is the complement of the shared
 * productive-liveness set, so any future non-productive state counts as empty.
 */
export function isEmptyTimerHeartbeat(input: {
  wakeReason: string | null;
  outcome: string;
  livenessState: RunLivenessState | null;
}): boolean {
  if (input.wakeReason !== "heartbeat_timer") return false;
  if (input.outcome !== "succeeded") return false;
  return input.livenessState === null || !PRODUCTIVE_RUN_LIVENESS_STATES.has(input.livenessState);
}
