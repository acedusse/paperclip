/**
 * FILE: server/src/services/fallback-chain.ts
 * ABOUT: fallback-chain.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - fallback-chain.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: fallback-chain.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/fallback-chain.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]

/**
 * Quota-aware provider fallback chains (combo 02 phase 2, idea 012).
 *
 * The repo already retries transient failures on a bounded ladder of 2m/10m/30m/2h.
 * That is right for a blip and exactly wrong for quota exhaustion: a 429 with an hour-long
 * reset window burns the whole ladder — nearly three hours — retrying a credential that
 * cannot succeed. This module supplies the missing third verdict between "retry the same
 * thing" and "give up": go somewhere else.
 *
 * Every function here is pure and total. It runs inside the failure-handling path of a run
 * that has already gone wrong, so it must never throw and never need I/O.
 */

/** Longest operator-configured chain. Beyond this an operator is describing a retry policy. */
export const MAX_FALLBACK_CHAIN_LENGTH = 4;

/** Hard cap on hops per run, enforced in the selector so every caller inherits it. */
export const MAX_FALLBACK_HOPS = 3;

/**
 * Wait beyond which retrying the same provider is pointless.
 *
 * Sits above the first ladder delay (2m) and below the second (10m): under it the ladder
 * retries sooner than the provider will be ready anyway, so hopping would be premature.
 */
export const FALLBACK_THRESHOLD_MS = 5 * 60 * 1000;

export interface FallbackChainEntry {
  adapterType: string;
  /** null means "keep whatever model the primary was configured with" */
  model: string | null;
}

export type FallbackVerdict = "do_not_retry" | "retry_same" | "fall_back";

/**
 * Failures that no amount of retrying or provider-switching fixes. Mirrors
 * NON_RETRYABLE_CONTINUATION_ERROR_CODES in recovery/service.ts.
 */
const NON_RETRYABLE_ERROR_CODES = new Set<string>([
  "agent_not_invokable",
  "agent_not_found",
  "budget_blocked",
  "budget_exhausted",
  "issue_paused",
  "issue_dependencies_blocked",
]);

/**
 * Unambiguous quota signals. No adapter emits these today; the branch exists so an adapter
 * can opt in without this module changing.
 */
const QUOTA_ERROR_CODE_PATTERN = /(quota_exhausted|rate_limited|quota_exceeded)$/;

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Decides what to do about a failed run.
 *
 * Fail-safe direction is `retry_same`: anything unrecognised preserves today's behaviour
 * exactly. A misclassification must never *invent* a fallback, because hopping has real
 * cost — a fresh session, a different model, and different billing.
 */
export function classifyFallbackTrigger(input: {
  errorFamily?: string | null;
  errorCode?: string | null;
  retryNotBefore?: Date | string | number | null;
  now: Date;
}): FallbackVerdict {
  const errorCode = readString(input.errorCode);

  // Checked first: a non-retryable failure stays non-retryable however long the provider
  // says to wait. A dead credential is not fixed by a different provider.
  if (errorCode && NON_RETRYABLE_ERROR_CODES.has(errorCode)) return "do_not_retry";

  if (errorCode && QUOTA_ERROR_CODE_PATTERN.test(errorCode)) return "fall_back";

  const retryNotBefore = toDate(input.retryNotBefore ?? null);
  if (retryNotBefore) {
    const waitMs = retryNotBefore.getTime() - input.now.getTime();
    // Strictly greater: exactly at the threshold is not yet worth the cost of a hop.
    if (waitMs > FALLBACK_THRESHOLD_MS) return "fall_back";
  }

  return "retry_same";
}

/**
 * Reads and normalises `adapterConfig.fallbackChain`.
 *
 * Malformed input degrades to an empty chain rather than throwing: an operator editing JSON
 * by hand should not be able to brick an agent, and a chain naming a plugin adapter that is
 * not installed on this host should simply skip that entry.
 */
export function parseFallbackChain(
  adapterConfig: unknown,
  opts?: { knownAdapterTypes?: ReadonlySet<string> },
): FallbackChainEntry[] {
  if (typeof adapterConfig !== "object" || adapterConfig === null) return [];
  const raw = (adapterConfig as Record<string, unknown>).fallbackChain;
  if (!Array.isArray(raw)) return [];

  const known = opts?.knownAdapterTypes ?? null;
  const parsed: FallbackChainEntry[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const adapterType = readString(record.adapterType);
    if (!adapterType) continue;
    if (known && !known.has(adapterType)) continue;

    const model = readString(record.model);
    const previous = parsed[parsed.length - 1];
    // Collapse consecutive duplicates: hopping to the identical target burns a hop for nothing.
    if (previous && previous.adapterType === adapterType && previous.model === model) continue;

    parsed.push({ adapterType, model });
    if (parsed.length >= MAX_FALLBACK_CHAIN_LENGTH) break;
  }

  return parsed;
}

export interface FallbackSelection {
  target: FallbackChainEntry;
  nextHop: number;
  /**
   * Session ids are adapter-specific — a codex_local session means nothing to opencode_local.
   * Returned here rather than left to the caller so the rule cannot be forgotten at a call site.
   */
  clearSession: boolean;
}

/** Picks the next chain entry, or null when the chain or the hop budget is spent. */
export function selectFallbackTarget(input: {
  chain: FallbackChainEntry[];
  currentHop: number;
  currentAdapterType: string;
}): FallbackSelection | null {
  const currentHop = Number.isFinite(input.currentHop) ? Math.max(0, Math.floor(input.currentHop)) : 0;
  if (currentHop >= MAX_FALLBACK_HOPS) return null;

  const target = input.chain[currentHop];
  if (!target) return null;

  return {
    target,
    nextHop: currentHop + 1,
    clearSession: target.adapterType !== input.currentAdapterType,
  };
}

/** Reads the active hop out of a run's contextSnapshot, clamped into range. */
export function readFallbackHop(contextSnapshot: unknown): number {
  if (typeof contextSnapshot !== "object" || contextSnapshot === null) return 0;
  const raw = (contextSnapshot as Record<string, unknown>).fallbackHop;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(Math.floor(raw), MAX_FALLBACK_HOPS);
}

export interface FallbackState {
  hop: number;
  adapterType: string;
  model: string | null;
}

/**
 * The fields a re-dispatched run carries in its contextSnapshot.
 *
 * The *resolved target* is persisted, not just an index into the chain. An index would be
 * re-derived against `adapterConfig` at dispatch time, which is a different read than the one
 * that made the decision: the operator can edit the chain between the failure and the retry,
 * and a chain filtered by installed adapter types does not index the same as an unfiltered one.
 * Either way the run would execute on an adapter nobody selected. Persisting the target makes
 * the decision immutable once taken.
 */
export function buildFallbackContext(selection: FallbackSelection): Record<string, unknown> {
  return {
    fallbackHop: selection.nextHop,
    fallbackAdapterType: selection.target.adapterType,
    fallbackModel: selection.target.model,
  };
}

/** Reads the persisted fallback target, or null when the run is on its primary adapter. */
export function readFallbackState(contextSnapshot: unknown): FallbackState | null {
  if (typeof contextSnapshot !== "object" || contextSnapshot === null) return null;
  const record = contextSnapshot as Record<string, unknown>;

  const hop = readFallbackHop(contextSnapshot);
  if (hop <= 0) return null;

  const adapterType = readString(record.fallbackAdapterType);
  // A hop without a recorded target is unusable — fall safe to the primary rather than
  // guessing an adapter from a possibly-edited chain.
  if (!adapterType) return null;

  return { hop, adapterType, model: readString(record.fallbackModel) };
}

export interface EffectiveAdapter {
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  isFallback: boolean;
  hop: number;
}

/**
 * Produces the adapter a run should actually execute on.
 *
 * Dispatch reads `agent.adapterType` in many places; threading an override through each is
 * invasive and easy to get half-right, which would produce a run that executes on one adapter
 * and bills to another. Resolving once here and handing downstream code a consistent effective
 * agent keeps that impossible.
 *
 * Falls safe to the primary for any out-of-range hop.
 */
export function resolveEffectiveAdapter(input: {
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  /** The persisted target from the run's contextSnapshot, or null for the primary adapter. */
  fallbackState: FallbackState | null;
}): EffectiveAdapter {
  const primary: EffectiveAdapter = {
    adapterType: input.adapterType,
    adapterConfig: input.adapterConfig,
    isFallback: false,
    hop: 0,
  };

  const state = input.fallbackState;
  if (!state) return primary;

  // The chain is stripped from the effective config so a fallback agent cannot fall back
  // off its own fallback; hop advancement is owned solely by the failure path.
  const { fallbackChain: _dropped, ...rest } = input.adapterConfig;

  return {
    adapterType: state.adapterType,
    adapterConfig: {
      ...rest,
      ...(state.model ? { model: state.model } : {}),
    },
    isFallback: true,
    hop: state.hop,
  };
}
// [END: module]
