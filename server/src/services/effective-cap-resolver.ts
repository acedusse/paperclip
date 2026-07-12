/**
 * FILE: server/src/services/effective-cap-resolver.ts
 * ABOUT: effective-cap-resolver.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - effective-cap-resolver.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: effective-cap-resolver.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/effective-cap-resolver.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { BreakerLevel, RunExecutionState } from "@paperclipai/shared";

// Locked precedence order (highest priority first). Later combo-01 slices
// register writers at these names; a unit test asserts this array so nothing
// can silently reorder it.
export const CAP_WRITER_PRECEDENCE = Object.freeze([
  "panic-drain",
  "predictive-breaker",
  "manual-override",
  "schedule",
  "configured-default",
] as const);

export type CapContext = {
  configuredMax: number | null;
  executionState?: RunExecutionState;
  breakerLevel?: BreakerLevel;
  manualOverrideCap?: number | null;
  scheduleCap?: number | null;
};

export type CapWriter = {
  name: string;
  precedence: number; // lower = higher priority
  resolve(ctx: CapContext): number | null; // null = "no opinion"
};

export const configuredDefaultWriter: CapWriter = {
  name: "configured-default",
  precedence: CAP_WRITER_PRECEDENCE.indexOf("configured-default"),
  resolve: (ctx) => ctx.configuredMax,
};

// Combo-01 Phase 2c: top-precedence writer. draining/halted force the cap to 0
// so the admission budget admits nothing. Absent/running = no opinion.
export const panicDrainWriter: CapWriter = {
  name: "panic-drain",
  precedence: CAP_WRITER_PRECEDENCE.indexOf("panic-drain"),
  resolve: (ctx) =>
    ctx.executionState === "halted" || ctx.executionState === "draining" ? 0 : null,
};

// Combo-01 Phase 3a: cap-mapping constants (the ladder/hysteresis constants live
// in predictive-breaker.ts; these two are the writer's authority on the cap).
export const BREAKER_THROTTLE_FACTOR = 0.5;
export const BREAKER_THROTTLE_UNCAPPED_CAP = 2;

// Reads the persisted breaker level (decided by the evaluator) and maps it to a
// cap. halt -> 0; throttle -> half the configured cap (floor 1), or the uncapped
// fallback when concurrency is otherwise unlimited; normal/warn/absent -> no opinion.
export const predictiveBreakerWriter: CapWriter = {
  name: "predictive-breaker",
  precedence: CAP_WRITER_PRECEDENCE.indexOf("predictive-breaker"),
  resolve: (ctx) => {
    switch (ctx.breakerLevel) {
      case "halt":
        return 0;
      case "throttle":
        return ctx.configuredMax == null
          ? BREAKER_THROTTLE_UNCAPPED_CAP
          : Math.max(1, Math.floor(ctx.configuredMax * BREAKER_THROTTLE_FACTOR));
      default:
        return null;
    }
  },
};

// Combo-01 Phase 3b: operator "boost / quiet now" override. Reads a pre-computed,
// unexpired override cap from the context (null when none/expired). Sits below the
// breaker, so a safety throttle/halt or a human panic always wins over a boost.
export const manualOverrideWriter: CapWriter = {
  name: "manual-override",
  precedence: CAP_WRITER_PRECEDENCE.indexOf("manual-override"),
  resolve: (ctx) => ctx.manualOverrideCap ?? null,
};

// Combo-01 Phase 3b: time-of-day schedule. Reads the currently-active window cap
// (most-restrictive-wins, computed at the resolver site); null outside every window.
export const scheduleWriter: CapWriter = {
  name: "schedule",
  precedence: CAP_WRITER_PRECEDENCE.indexOf("schedule"),
  resolve: (ctx) => ctx.scheduleCap ?? null,
};

// Company resolver sites use this set (instance sites have no breaker — no budget).
export const PHASE3_COMPANY_WRITERS: CapWriter[] = [
  panicDrainWriter,
  predictiveBreakerWriter,
  configuredDefaultWriter,
];

// Company resolver sites use this set once schedule + manual override ship.
export const PHASE3B_COMPANY_WRITERS: CapWriter[] = [
  panicDrainWriter,
  predictiveBreakerWriter,
  manualOverrideWriter,
  scheduleWriter,
  configuredDefaultWriter,
];

export const PHASE1_WRITERS: CapWriter[] = [panicDrainWriter, configuredDefaultWriter];

// First non-null writer by ascending precedence wins. null cap = unlimited.
export function resolveEffectiveCap(
  ctx: CapContext,
  writers: CapWriter[],
): { cap: number | null; source: string } {
  const ordered = [...writers].sort((a, b) => a.precedence - b.precedence);
  for (const writer of ordered) {
    const value = writer.resolve(ctx);
    if (value !== null) return { cap: value, source: writer.name };
  }
  return { cap: null, source: "none" };
}
// [END: module]
