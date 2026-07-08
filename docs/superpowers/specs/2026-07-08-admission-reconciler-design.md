# Admission Reconciler — Design (Combo-01 Phase 1)

**Status:** Approved
**Date:** 2026-07-08
**Slice of:** Combo-01 Phase 1 — Foundations (see `.ideas/combinations/combo-01-phasing-corrected.md`)

## Goal

Deliver the Phase-1 "reconciler" deliverable — the crash-safety mechanism that recomputes
live state from ground truth and reclaims leaked admission slots — as a **pluggable source
registry**, and prove the phase exit criterion (kill server mid-run → slot reclaimed within
one reconciler tick, no permanent leak) with a regression test against the admission caps.

## Context / key finding

The admission gate shipped in earlier Phase-1 slices has **no persistent slot counter**. Every
tick it recomputes the running count live from the DB (`countRunningRunsInstanceWide` /
`countRunningRunsForCompany`, `WHERE status='running'` in `server/src/services/heartbeat.ts`).
That is ground truth by construction — there is no derived counter that can drift.

`reapOrphanedRuns` (`server/src/services/heartbeat.ts:8021`) already:

- runs at **startup** and on **every scheduler tick** (5-minute staleness threshold),
- selects every `status='running'` row, checks **actual liveness** (in-memory process handle,
  real pid / process-group liveness, detached-process handling), and
- transitions dead rows to `failed` (with a retry-once path).

Because the gate counts live `running` rows, the moment the reaper flips a dead run out of
`running`, its admission slot is reclaimed on the next gate tick. The slot-reclaim behavior the
phasing doc asks for therefore **already exists** for the cap plane; what is missing is (a) a
test proving it against the caps and (b) the *extension-point structure* the phasing doc
emphasizes: the reconciler must be built to reconcile "counters and leases, not only slot
counts" so Phase 2 (per-run cumulative counters) and Phase 4 (lease claims) plug into one loop —
the same compose-by-construction reasoning that made the cap resolver a registry.

This slice does **not** rewrite the reaper. It wraps the existing behavior in a named, uniform
seam and proves the exit criterion.

## Architecture

### The reconciler interface (extension point)

New file `server/src/services/admission-reconciler.ts` — a fault-isolating fold over a list of
sources. It owns **no timer and no DB knowledge**; it is the sibling of the cap resolver's
writer registry.

```typescript
type ReconcileResult = { source: string; drifted: number; repaired: number };

type ReconcileSource = {
  name: string;
  // Detect drift from ground truth and repair it. Owns its own detection +
  // repair; returns what it found. Must never throw for "nothing to do".
  reconcile(now: Date): Promise<ReconcileResult>;
};

// Runs every source, fault-isolated: one source throwing is logged and
// skipped, never aborts the others. Returns the per-source results.
async function runReconcile(sources: ReconcileSource[], now: Date): Promise<ReconcileResult[]>;

const PHASE1_RECONCILE_SOURCES: ReconcileSource[] = [runLivenessSource];
```

Fault isolation is the one real behavior `runReconcile` adds beyond iteration: a future counter
source blowing up must not stop lease reclaim. Extension mechanism: Phase 2 pushes a
`perRunCounterSource`, Phase 4 pushes a `leaseSource`; neither touches this file or the loop.

### The Phase-1 source (delegates, does not rewrite)

`runLivenessSource` is the single Phase-1 source. It **delegates to the existing
`reapOrphanedRuns`** rather than reimplementing liveness detection.

```typescript
const runLivenessSource: ReconcileSource = {
  name: "run-liveness",
  async reconcile(now) {
    // 5-min staleness threshold, same as today's periodic reaper call.
    const { reaped, runIds } = await heartbeat.reapOrphanedRuns({ staleThresholdMs: 5 * 60 * 1000 });
    return { source: "run-liveness", drifted: reaped, repaired: runIds.length };
  },
};
```

No behavior change in Phase 1 — just the structure future sources plug into. The `heartbeat`
handle is injected (the reconciler is constructed with the dependencies it needs; it does not
import the heartbeat singleton directly), keeping the module testable in isolation.

### Integration point (one timer, not two)

No new `setInterval`. The reconciler slots into the **existing** periodic sweep in
`server/src/index.ts` (the `heartbeatSchedulerIntervalMs` block, ~854–932), **replacing** the
current bare `reapOrphanedRuns` call at the head of the promise chain:

```typescript
// was: void heartbeat.reapOrphanedRuns({ staleThresholdMs: 5*60*1000 }).then(...)
void runReconcile(PHASE1_RECONCILE_SOURCES, new Date())
  .then((results) => {
    const changed = results.filter((r) => r.repaired > 0);
    if (changed.length > 0) logger.warn({ results: changed }, "admission reconciler repaired drift");
  })
  .then(() => heartbeat.promoteDueScheduledRetries())
  .then(/* ...rest of the existing chain unchanged... */)
```

The rest of the chain (`promoteDueScheduledRetries`, `resumeQueuedRuns`,
`reconcileStrandedAssignedIssues`, etc.) is untouched. To avoid `reapOrphanedRuns` running twice
per tick, the reconciler becomes the **single caller** of the reaper in the periodic path.
The **startup** `reapOrphanedRuns` call (before timers start) stays exactly as-is — it is not
part of the reconcile loop. Cadence, staleness threshold, and startup behavior are identical to
today, so the "one reconciler tick" exit-criterion timing is unchanged.

## Testing

### Layer 1 — seeded-orphan cap-reclaim (new, fast, always runs)

New `server/src/__tests__/admission-reconciler.test.ts` on embedded postgres:

```
- instance cap = 10; seed 10 'running' rows with NO runningProcesses handle
  and updatedAt older than the staleness threshold (exact post-crash DB state)
- saturate the queue with more queued runs
- gate tick BEFORE reconcile: assert 0 admitted (cap full of orphans)
- runReconcile(PHASE1_RECONCILE_SOURCES, now)  -> reaps the 10 dead rows
- gate tick AFTER reconcile: assert runs admitted up to 10 again
```

Plus a unit test that `runReconcile` **fault-isolates**: given two sources where the first
throws, the throw is logged and skipped and the second source still runs and reports its result.

### Layer 2 — real-process path (extend existing suite)

Extend `server/src/__tests__/heartbeat-process-recovery.test.ts` (which already spawns real
detached children and kills them) with one case that drives reclaim **through `runReconcile`**
(not `reapOrphanedRuns` directly) and asserts the row is `failed` and the slot is freed —
proving the seam behaves identically to the raw reaper on the real-process path. Inherits that
suite's skip-on-unsupported-host guard.

## Out of scope (Phase 1)

- Per-run cumulative counters (P2) and lease reclaim (P4) — the interface *anticipates* them;
  it does not build them.
- Any change to `reapOrphanedRuns` internals, the startup reap, or cap-resolver / gate logic.
- No new run status, no `queued_admission`, no admit/defer audit logging (a separate remaining
  Phase-1 item, tracked elsewhere).

## Conventions

- New source file carries the `// [START: module]` / `// [END: module]` nav tags per repo
  convention; run `python3 scripts/nav/nav_endhook.py` before the final commit.
- Follow existing service-module file structure (FILE/ABOUT header + META block), matching
  `effective-cap-resolver.ts` and `instance-admission-lock.ts`.

## Exit criteria

- Layer-1 test proves: with an instance cap and the cap fully consumed by orphaned `running`
  rows, one `runReconcile` pass frees the slots and the gate re-admits up to the cap on the next
  tick.
- `runReconcile` fault-isolation unit test passes.
- Layer-2 real-process case proves reclaim through the reconciler seam.
- No behavior change to startup reap, reaper internals, or the gate; periodic sweep calls the
  reaper exactly once per tick, now via the reconciler.
