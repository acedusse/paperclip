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

export type CapContext = { configuredMax: number | null };

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

export const PHASE1_WRITERS: CapWriter[] = [configuredDefaultWriter];

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
