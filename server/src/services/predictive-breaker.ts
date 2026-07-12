// Combo-01 Phase 3a: predictive budget circuit breaker — pure ladder + hysteresis.
// The evaluator (below, dependency-injected) drives these; the cap-mapping lives
// in effective-cap-resolver.ts. No DB or clock access here — `now` is passed in.
import type { BreakerLevel } from "@paperclipai/shared";

export const BREAKER = {
  warnMult: 2, // warn when timeToLimit <= 2H
  throttleMult: 1, // throttle when timeToLimit <= H
  haltMult: 0.25, // halt when timeToLimit <= H/4
  minDwellMs: 10 * 60_000, // hold a level >= 10 min before de-escalating
  burnWindowMs: 15 * 60_000, // rolling window for the burn rate
  upGap: 1.5, // de-escalation up-threshold = down-threshold * upGap
} as const;

const SEVERITY: Record<BreakerLevel, number> = { normal: 0, warn: 1, throttle: 2, halt: 3 };
const ONE_RUNG_BELOW: Record<BreakerLevel, BreakerLevel> = {
  halt: "throttle",
  throttle: "warn",
  warn: "normal",
  normal: "normal",
};

// minutes; Infinity when not burning; 0 when the budget is already exhausted.
export function computeTimeToLimit(remainingCents: number, burnRateCpm: number): number {
  if (remainingCents <= 0) return 0;
  if (burnRateCpm <= 0) return Infinity;
  return remainingCents / burnRateCpm;
}

// The rung the raw timeToLimit warrants right now (no hysteresis). Most-severe first.
export function classifyDownLevel(timeToLimitMin: number, horizonMin: number): BreakerLevel {
  if (timeToLimitMin <= horizonMin * BREAKER.haltMult) return "halt";
  if (timeToLimitMin <= horizonMin * BREAKER.throttleMult) return "throttle";
  if (timeToLimitMin <= horizonMin * BREAKER.warnMult) return "warn";
  return "normal";
}

// The down-threshold boundary (in minutes) at which `level` becomes active.
function downThreshold(level: BreakerLevel, horizonMin: number): number {
  switch (level) {
    case "halt":
      return horizonMin * BREAKER.haltMult;
    case "throttle":
      return horizonMin * BREAKER.throttleMult;
    case "warn":
      return horizonMin * BREAKER.warnMult;
    default:
      return Infinity;
  }
}

// Escalate immediately (may jump rungs). De-escalate one rung per call, and only
// when BOTH the min-dwell has elapsed AND timeToLimit has cleared the gapped
// up-threshold for the current level.
export function nextLevelWithHysteresis(
  current: BreakerLevel,
  since: Date,
  timeToLimitMin: number,
  horizonMin: number,
  now: Date,
): BreakerLevel {
  const raw = classifyDownLevel(timeToLimitMin, horizonMin);
  if (SEVERITY[raw] > SEVERITY[current]) return raw; // escalate now
  if (SEVERITY[raw] === SEVERITY[current]) return current; // hold

  const dwellMet = now.getTime() - since.getTime() >= BREAKER.minDwellMs;
  const upThreshold = downThreshold(current, horizonMin) * BREAKER.upGap;
  if (dwellMet && timeToLimitMin > upThreshold) return ONE_RUNG_BELOW[current];
  return current; // not yet safe to relax
}

export type BreakerEvalDeps = {
  // Rolling windowed burn rate (cents/min) over BREAKER.burnWindowMs.
  getBurnRateCentsPerMin(companyId: string): Promise<number>;
  // Remaining cents of the MOST URGENT active company-scoped billed_cents budget
  // (min remaining across policies). null => the company is ineligible (no budget).
  getMostUrgentRemainingCents(companyId: string): Promise<number | null>;
  loadState(companyId: string): Promise<{ level: BreakerLevel; since: Date } | null>;
  saveState(
    companyId: string,
    row: { level: BreakerLevel; since: Date; lastBurnRateCpm: number; lastTimeToLimitM: number | null },
  ): Promise<void>;
  windDownCompanyRuns(companyId: string): Promise<void>;
  logTransition(
    companyId: string,
    from: BreakerLevel,
    to: BreakerLevel,
    ctx: { burnRateCpm: number; timeToLimitMin: number; remainingCents: number },
  ): Promise<void>;
};

export async function evaluateCompanyBreaker(
  deps: BreakerEvalDeps,
  companyId: string,
  horizonMinutes: number,
  now: Date,
): Promise<BreakerLevel> {
  const remaining = await deps.getMostUrgentRemainingCents(companyId);
  const prev = (await deps.loadState(companyId)) ?? { level: "normal" as BreakerLevel, since: now };

  // Ineligible (no budget): relax to normal. Persist only if we were non-normal.
  if (remaining === null) {
    if (prev.level !== "normal") {
      await deps.saveState(companyId, {
        level: "normal",
        since: now,
        lastBurnRateCpm: 0,
        lastTimeToLimitM: null,
      });
      await deps.logTransition(companyId, prev.level, "normal", {
        burnRateCpm: 0,
        timeToLimitMin: Infinity,
        remainingCents: 0,
      });
    }
    return "normal";
  }

  const burn = await deps.getBurnRateCentsPerMin(companyId);
  const tt = computeTimeToLimit(remaining, burn);
  const next = nextLevelWithHysteresis(prev.level, prev.since, tt, horizonMinutes, now);

  await deps.saveState(companyId, {
    level: next,
    since: next === prev.level ? prev.since : now,
    lastBurnRateCpm: burn,
    lastTimeToLimitM: Number.isFinite(tt) ? tt : null,
  });
  if (next !== prev.level) {
    await deps.logTransition(companyId, prev.level, next, {
      burnRateCpm: burn,
      timeToLimitMin: tt,
      remainingCents: remaining,
    });
  }
  // Wind down EVERY tick while halted — idempotent, and the crash-safe backstop.
  if (next === "halt") await deps.windDownCompanyRuns(companyId);
  return next;
}
