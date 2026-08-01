# Combo 02 Phase 2 — Quota-Aware Provider Fallback Chains

**Date:** 2026-08-01
**Combo:** 02 — Mixed-Economy Model & Provider Fabric
**Phase:** 2 of 4 (idea 012)
**Depends on:** Phase 1 (local inference billing truth) — merged to `master` as PR #38
**Status:** design, implementing

---

## Pre-flight findings

| Claim | Verified on `master` @ `3dfc591` |
|-------|----------------------------------|
| `fallbackChain` exists | **No.** Zero hits repo-wide. |
| Quota observation exists | **Yes.** `quota-windows.ts` aggregates `getQuotaWindows()` per adapter — but nothing acts on it. |
| Failure classification exists | **Partially, and it is the crux.** See below. |
| A retry path exists to hook into | **Yes.** `scheduleBoundedTransientHeartbeatRetry` in `heartbeat.ts`. |

### The gap this phase closes

The repo already retries transient failures on a bounded ladder:

```
BOUNDED_TRANSIENT_HEARTBEAT_RETRY_DELAYS_MS = [2m, 10m, 30m, 2h]
```

with a codex-specific escalation (`same_session` → `safer_invocation` → `fresh_session` →
`fresh_session_safer_invocation`). That ladder is correct for a *blip* — a 500, a dropped
connection, a timeout.

It is exactly wrong for **quota exhaustion**. `TRANSIENT_INFRA_CONTINUATION_ERROR_CODES`
(`recovery/service.ts:194`) lumps `codex_transient_upstream` in with `adapter_failed` and
`timeout`, so a 429 with a one-hour reset window is treated as a blip: the agent waits 2m, retries
the same exhausted credential, waits 10m, retries, waits 30m, retries, waits 2h, then gives up —
**nearly three hours of wall-clock burned on a provider that cannot succeed**, which is precisely
the 2am freeze idea 012 exists to remove.

The fix is not a new retry mechanism. It is a **third classification** between "retry the same
thing" and "give up", plus somewhere else to go.

## Design

### 1. Three-way trigger classification

`classifyFallbackTrigger` returns one of:

| Verdict | Meaning | Action |
|---------|---------|--------|
| `do_not_retry` | auth failure, bad config, agent logic error | fail the run, as today |
| `retry_same` | transient blip | existing bounded ladder, unchanged |
| `fall_back` | quota/rate-limit exhausted | advance to the next chain entry |

The discriminator between `retry_same` and `fall_back` is **already in the contract**:
`AdapterExecutionResult.retryNotBefore`. A provider that says "retry after 3600s" is telling us the
credential is spent; a provider that says nothing, or says "200ms", had a blip.

> **Rule:** `fall_back` when `retryNotBefore - now > FALLBACK_THRESHOLD_MS` (5 minutes).

Five minutes sits above the first ladder delay (2 m) and below the second (10 m). Below the
threshold the ladder will retry sooner than the provider will be ready anyway, so falling back
would be premature; above it, the ladder is guaranteed to waste at least one full cycle.

An explicit quota error code (`*_quota_exhausted`, `*_rate_limited`) also yields `fall_back`
regardless of `retryNotBefore`, since that is unambiguous. No adapter emits those today; the branch
exists so an adapter can opt in without touching this module.

**Fail-safe direction:** anything unrecognised classifies as `retry_same`, preserving today's
behaviour exactly. A misclassification must never *invent* a fallback.

### 2. Chain configuration

`agents.adapterConfig.fallbackChain` — an ordered array, default absent (current behaviour):

```jsonc
"fallbackChain": [
  { "adapterType": "codex_local", "model": "gpt-5" },      // premium
  { "adapterType": "opencode_local", "model": "..." },     // cheap
  { "adapterType": "pi_local", "local": true }             // free — Phase 1's tier
]
```

`agents.adapter_config` is `jsonb`, so **no migration**.

Validation is strict and total — a malformed chain must degrade to "no chain", never throw inside
the run path:

- unknown `adapterType` values are dropped (not fatal — an operator editing JSON should not brick
  their agent, and a plugin adapter may legitimately be absent on this host)
- consecutive duplicates collapse — hopping from an adapter to itself is a no-op that burns a hop
- the chain is capped at `MAX_FALLBACK_CHAIN_LENGTH` (4); beyond that an operator is describing a
  retry policy, not a fallback strategy
- a non-array, or an array of non-objects, yields an empty chain

### 3. Hop tracking

The active chain position lives in `heartbeatRuns.contextSnapshot.fallbackHop` — `jsonb`, so again
**no migration**. `0`/absent means the primary adapter.

Hop count is capped independently of chain length by `MAX_FALLBACK_HOPS`, so a pathological config
cannot produce unbounded re-dispatch. The cap is enforced in the selector, not at the call site,
so every caller inherits it.

### 4. Session non-portability — the correctness trap

Idea 012 §3 says to re-dispatch "preserving session/context where the target adapter supports it."
**Across different adapters it never does.** A `codex_local` session id is meaningless to
`opencode_local`; the repo already encodes this with `isCanonicalSessionIdForAdapter` and
`requiresCanonicalSessionIds`. Carrying a session across a hop would resume nothing at best, and at
worst hand a CLI an identifier it will try to interpret.

> **Rule:** a hop that changes `adapterType` clears the session. A hop that changes only `model`
> within the same `adapterType` preserves it.

This is why `selectFallbackTarget` returns `clearSession` alongside the target rather than leaving
it to the caller to remember.

### 5. Effective adapter resolution

Dispatch reads `agent.adapterType` in many places (`heartbeat.ts:10255`, `:10257`, `:10265`,
`:10280`, …). Threading an override through each is invasive and easy to get half-right, which
would produce a run that executes on one adapter and bills to another.

Instead, one function produces an **effective agent** — a shallow copy with `adapterType` and
`adapterConfig.model` overridden — resolved once before dispatch. Everything downstream, including
Phase 1's billing path, then sees a single consistent adapter with no further changes.

### Components

**`server/src/services/fallback-chain.ts`** (new — pure, no DB, no I/O)

```ts
export const MAX_FALLBACK_CHAIN_LENGTH = 4;
export const MAX_FALLBACK_HOPS = 3;
export const FALLBACK_THRESHOLD_MS = 5 * 60 * 1000;

export interface FallbackChainEntry { adapterType: string; model: string | null }
export type FallbackVerdict = "do_not_retry" | "retry_same" | "fall_back";

export function parseFallbackChain(adapterConfig: unknown, opts?: { knownAdapterTypes?: ReadonlySet<string> }): FallbackChainEntry[];
export function classifyFallbackTrigger(input: {
  errorFamily?: string | null; errorCode?: string | null;
  retryNotBefore?: Date | string | null; now: Date;
}): FallbackVerdict;
export function selectFallbackTarget(input: {
  chain: FallbackChainEntry[]; currentHop: number; currentAdapterType: string;
}): { target: FallbackChainEntry; nextHop: number; clearSession: boolean } | null;
export function resolveEffectiveAdapter(input: {
  adapterType: string; adapterConfig: Record<string, unknown>; hop: number;
}): { adapterType: string; adapterConfig: Record<string, unknown>; isFallback: boolean; hop: number };
export function readFallbackHop(contextSnapshot: unknown): number;
```

`now` is an explicit parameter, never `Date.now()` — the classifier must be testable at exact
boundaries.

### Data flow

```
adapter fails
  → AdapterExecutionResult { errorFamily, errorCode, retryNotBefore }
  → classifyFallbackTrigger(...)
      ├─ do_not_retry → fail run                          (unchanged)
      ├─ retry_same   → bounded ladder 2m/10m/30m/2h       (unchanged)
      └─ fall_back    → selectFallbackTarget(chain, hop)
                          ├─ null → bounded ladder         (chain spent: degrade, don't fail)
                          └─ target → contextSnapshot.fallbackHop = nextHop
                                      clear session if adapterType changed
                                      re-dispatch
  → next dispatch: resolveEffectiveAdapter(agent, hop) → effective adapterType + model
  → Phase 1 billing records the provider that actually served the run
```

When the chain is spent, the run falls back to the *existing ladder* rather than failing. Fallback
is strictly an improvement over current behaviour; exhausting it must return to current behaviour.

## Testing

`fallback-chain.test.ts` — pure, no DB:

- **classification matrix**: every combination of `errorFamily` × `errorCode` × `retryNotBefore`
  offset, including the exact `FALLBACK_THRESHOLD_MS` boundary (at, just under, just over)
- unrecognised input → `retry_same` (the fail-safe direction, asserted explicitly)
- `retryNotBefore` in the past, malformed, and as `string` vs `Date`
- **chain parsing**: non-array, array of junk, unknown adapter types, consecutive duplicates,
  over-length, missing `model`, and the valid case
- **selection**: hop cap enforcement, chain exhaustion → null, `clearSession` true on adapter
  change and false on model-only change
- **effective adapter**: hop 0 → unchanged primary; hop N → chain entry; out-of-range hop →
  primary (never throws)

Integration: `resolveEffectiveAdapter` at hop 0 returns the agent unchanged — the proof that an
agent with no chain configured is bit-identical to today.

## Exit criteria

1. An agent with no `fallbackChain` behaves exactly as on `master` (asserted by test).
2. A quota failure with a long `retryNotBefore` advances the hop instead of burning the ladder.
3. A blip still uses the ladder.
4. A hop across adapter types clears the session.
5. Chain exhaustion degrades to the ladder, never to a hard failure.
6. Full canonical suite green.

## Out of scope

- **Inbox nudge for chronic fallback** (idea 012 §5, second half) — needs a rolling per-agent
  fallback-rate signal; that is combo 03's `run-signals` territory and should reuse it rather than
  grow a private counter here.
- **UI surfacing** of "served by fallback" beyond the run event.
- **Predictive-breaker integration** (combo 01 idea 002 *preferring* the cheap tier under budget
  pressure) — that is a scheduling-time decision, not a failure-time one, and belongs with combo 04.
