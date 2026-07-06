# Combo-01 Phase 1 — Instance admission slice (design)

**Date:** 2026-07-06
**Status:** Approved design, pre-implementation
**Parent plan:** `.ideas/combinations/combo-01-phasing-corrected.md` (Phase 1)
**Scope decision:** thinnest vertical slice of Phase 1 — prove the compose-by-construction
spine, defer the rest to follow-on slices that plug into it.

## Goal

Introduce an instance-wide concurrency ceiling on agent runs, enforced through a single
admission choke point, resolved through a precedence-ordered cap registry. The slice must be
a **no-op until an operator configures a cap** and must **never allow real concurrency to
exceed the configured ceiling**.

## In scope

1. **Effective-cap resolver** — a registry that resolves cap *writers* in a fixed precedence
   order (`panic/drain > predictive breaker > manual override > schedule > configured default`),
   first non-null wins. Ships with only the `configured-default` writer.
2. **`instanceMaxConcurrentRuns`** — new optional instance setting. Unset ⇒ unlimited.
3. **Instance admission lock** — an instance-scoped in-memory async mutex.
4. **Admission-seam edit** — gate the claim loop in `startNextQueuedRunForAgent`
   (`server/src/services/heartbeat.ts`) on `min(perAgentSlots, instanceSlots)`.

## Explicitly out of scope (later slices, plugging into these seams)

Per-company cap; manual-override writer; extraction of a pluggable `selectNextRun`;
crash-safe reconciler; UI "Running N / cap M · K waiting" badge; a distinct
`queued_admission` run status. Cap-deferred runs stay `status="queued"` and are
re-evaluated on the next heartbeat tick.

## Architecture & components

### 1. `server/src/services/effective-cap-resolver.ts` (new)

```ts
type CapWriter = {
  name: string;
  precedence: number;               // lower = higher priority
  resolve(ctx: CapContext): number | null;   // null = "no opinion"
};

// Locked precedence order; a unit test asserts it so future writers can't reorder.
resolveEffectiveCap(ctx): { cap: number | null; source: string };  // null cap = unlimited
```

Resolution: iterate writers in precedence order, return the first non-null value and its
source. Phase 1 registers a single writer, `configured-default`, which returns
`instanceMaxConcurrentRuns` (or `null` when unset).

### 2. `instanceMaxConcurrentRuns` on `instance-settings.ts`

New optional numeric setting. Unset/null ⇒ the `configured-default` writer returns `null`
⇒ resolver yields unlimited ⇒ admission gates nothing ⇒ behavior identical to today.

### 3. `server/src/services/instance-admission-lock.ts` (new)

A single global async mutex mirroring the in-memory promise-chain pattern of
`agent-start-lock.ts`, including its 30s stale-timeout fail-open behavior.

### 4. Edit to `startNextQueuedRunForAgent` (`heartbeat.ts`)

Wrap the count+claim critical section in the instance admission lock. Recovery and
scheduled-retry paths need **no changes**: they re-enter by setting `status="queued"` and
flow through this same single `executeRun` choke point (verified: only one `executeRun`
call site exists).

## Data flow

```
startNextQueuedRunForAgent(agentId)
└─ withAgentStartLock(agentId)                         [existing, outer]
   ├─ perAgentSlots = policy.maxConcurrentRuns − countRunningRunsForAgent(agentId)
   ├─ if perAgentSlots ≤ 0 → return []
   ├─ prioritizedRuns = sort(queuedRuns)               [existing inline sort, untouched]
   └─ withInstanceAdmissionLock(async () => {          [NEW, inner — serializes across agents]
        cap        = resolveEffectiveCap()             // null ⇒ unlimited
        running    = countRunningRunsInstanceWide()    // DB truth: status="running"
        instanceSlots = cap === null ? ∞ : max(0, cap − running)
        budget     = min(perAgentSlots, instanceSlots)
        for run in prioritizedRuns:
          if claimed.length ≥ budget: break
          claimed = claimQueuedRun(run)   // atomic queued→running (WHERE status='queued')
      })
   └─ for run in claimed: void executeRun(run.id)      [existing, after lock released]
```

**Correctness anchor:** `claimQueuedRun` flips `queued→running` via an atomic conditional
UPDATE *synchronously* inside the lock, so a run claimed this tick is immediately visible to
`countRunningRunsInstanceWide()` for the next agent that enters the lock. No new status and
no in-memory counter are needed for cross-agent correctness.

**Lock ordering:** always agent-lock (outer) → instance-lock (inner); an agent lock is never
acquired while holding the instance lock ⇒ no deadlock. The instance lock is held only for
one COUNT + N atomic UPDATEs, never across `executeRun`.

## Error handling & failure modes

Fail-safe by construction; every failure degrades toward today's behavior.

- **Crash / leaked `running` rows** → instance count *over*-counts → admission is *more*
  conservative → temporary under-utilization, never an overshoot. This is why deferring the
  reconciler is safe: it only restores throughput, it is never load-bearing for the ceiling.
- **Instance-lock staleness** → reuse the 30s stale-timeout fail-open from `agent-start-lock`.
  A hung holder yields a bounded transient overshoot identical in class to the existing
  agent-lock trade-off.
- **Resolver / COUNT failure** → log a warning and fall back to `cap = null` (unlimited),
  i.e. per-agent-only admission. The new gate must never take down run execution.
- **Null claims** → `claimQueuedRun` returning `null` never increments `claimed.length` and
  never flips a row to `running`, so it consumes neither a per-agent nor an instance slot.

### Known limitation (Phase 1)

The instance admission lock is an **in-memory, single-process** mutex. It serializes the
count+claim step only *within one server process*. If the deployment runs multiple server
replicas, each replica holds its own independent lock, so each can admit up to the cap and
the replicas can collectively breach the instance ceiling. Phase 1 accepts this: it targets
the single-process deployment and still guarantees the ceiling there. The multi-process fix
(a DB advisory lock or `SELECT ... FOR UPDATE` around the count+claim) is a later slice.

## Testing (TDD, red-first)

Existing `server/src/__tests__` harness + `embedded-postgres.ts` helper; real DB, no mocks.

**Resolver unit tests** (`effective-cap-resolver.test.ts`, pure):
- Precedence resolves first-non-null-wins in the locked order (asserts the order itself).
- Single `configured-default` writer returns the configured value; unset ⇒ `null`.

**Admission integration tests** (`heartbeat-instance-admission.test.ts`, embedded pg):
- **Exit criterion:** 30 agents, high per-agent concurrency, instance cap = 10, saturated
  queue ⇒ instance-wide `running` never exceeds 10 across many ticks.
- **No-op when unset:** unset cap ⇒ claim behavior identical to today (regression guard).
- **min(perAgent, instance):** per-agent cap 2, instance cap 10, one agent ⇒ only 2 claimed.
- **Cross-agent serialization:** concurrent `startNextQueuedRunForAgent` calls ⇒ total
  admitted respects the instance cap (closes the race the lock exists to close).
- **Fail-open:** settings/COUNT throws ⇒ falls back to per-agent-only, runs still start.
- **Leaked-running is conservative:** orphan `running` rows ⇒ under-admits, never breaches.

## Definition of done

- All tests above pass (each written red-first).
- `instanceMaxConcurrentRuns` unset ⇒ no behavioral change (proven by the no-op test).
- With a cap set, instance-wide running never exceeds it under saturation.
- Nav map synced via `scripts/nav/nav_endhook.py` for any new/changed source files.
