# Design: Graceful Wind-Down Primitive (Combo 01, Phase 2.0)

- **Date:** 2026-07-11
- **Combo:** 01 — Unified Runtime Control Plane
- **Phase:** 2.0 — the shared wind-down substrate that Phase 2a (per-run caps / idea 024)
  and Phase 2c (Panic Stop + Drain / idea 014) both build on.
- **Status:** Approved design, pre-implementation.

## Problem

Phase 2 needs to *stop* an in-flight run for two reasons — a per-run cap was exceeded
(024) or an operator hit Panic/Drain (014). Today the only way to stop a run is
`cancelRunInternal` (`server/src/services/heartbeat.ts:11908`), a **hard process kill**
via `terminateHeartbeatRunProcess` that ends the run `cancelled` and does not preserve the
interrupted work for resumption. A heartbeat run is one agent turn (one process
invocation); there is **no mid-turn checkpoint**. The only durable resume state is the
persisted Claude Code session (on-disk transcript) plus the between-runs continuation
summary (`refreshIssueContinuationSummary`, `issue-continuation-summary.ts`).

The corrected phasing (`.ideas/combinations/combo-01-phasing-corrected.md`) calls this out:
without a shared graceful wind-down primitive, both 024 and 014 silently degrade to
work-destroying hard kills. 2.0 builds that primitive **once**, so 2a/2c consume it.

## Scope

**In scope (2.0):** the `windDownRun` primitive; the `wound_down` run status +
`windDownReason` + `resumePolicy` columns; continuation capture on hard wind-down; the
re-enqueue path; a crash-safety reconcile source; integration tests. Proven by calling
`windDownRun` directly in tests.

**Out of scope (later phases):** any product caller/endpoint, per-run cap columns and
enforcement (2a), company/instance `executionState` and the Panic/Drain UI (2c). 2.0 ships
as pure substrate with **no** product trigger.

## Design decisions (locked)

1. **Two modes.** `soft` = let the current turn finish, then don't continue it. `hard` =
   terminate the current turn now, but capture a continuation artifact so the work is
   resumable.
2. **Caller supplies the resume policy.** `windDownRun` takes `resume: "when-allowed" | "no"`.
   The primitive decides whether to re-enqueue; it does not infer intent. (024 passes
   `when-allowed`; 014-panic passes `no`; 014-drain passes `when-allowed` with `soft`.)
3. **New `wound_down` status** on `heartbeat_runs`, plus a `windDownReason` field, so the
   governor / reconciler / metrics can tell "stopped-but-resumable" apart from a normal
   finish or a user cancel. `status` is a free-text column today
   (`heartbeat_runs.ts:28`), so the new value needs no DB enum migration — only the two new
   columns do.
4. **Soft-completed runs stay `finished`.** A soft wind-down lets the turn complete
   normally; we annotate `windDownReason` and gate promotion, but the terminal status is
   `finished`. `wound_down` is reserved for the hard cut.

## Interface

New module `server/src/services/run-wind-down.ts`, following the **injected-deps pattern**
established by `admission-reconciler.ts` — it stays out of the heartbeat singleton and is
testable in isolation. Heartbeat wires the concrete deps.

```ts
export type WindDownMode   = "soft" | "hard";
export type ResumePolicy   = "when-allowed" | "no";
export type WindDownReason = "cap-wallclock" | "cap-cost" | "panic" | "drain";

export type WindDownDeps = {
  getRun(runId: string): Promise<Run | null>;
  terminateProcess(run: Run): Promise<void>;          // wraps terminateHeartbeatRunProcess + runningProcesses.delete
  setRunStatus(runId, status, patch): Promise<Run>;
  captureContinuation(run: Run): Promise<void>;        // wraps refreshIssueContinuationSummary
  releaseIssue(run: Run, opts: { reenqueue: boolean }): Promise<void>; // wraps releaseIssueExecutionAndPromote (+ continuation enqueue)
  setWakeupStatus(wakeupRequestId, status, patch): Promise<void>;
  appendRunEvent(run, ...): Promise<void>;
  markSoftIntent(runId, reason, resume): Promise<void>; // soft mode: persist intent on the running row
};

export async function windDownRun(
  deps: WindDownDeps,
  runId: string,
  opts: { mode: WindDownMode; resume: ResumePolicy; reason: WindDownReason },
): Promise<{ outcome: "terminated" | "marked-soft" | "noop"; run: Run | null }>;
```

## Behavior

### Hard mode (mirrors `cancelRunInternal`, diverges at status + resume)

1. Load run; return `{ outcome: "noop" }` if it is not in a running/cancellable status.
2. **Capture continuation first** (`captureContinuation`) to snapshot last-known state,
   then `terminateProcess` using the existing grace window (SIGTERM→SIGKILL — gives the
   adapter a chance to flush on its own).
3. `setRunStatus → "wound_down"` with `windDownReason`, `resumePolicy`, `finishedAt`;
   cancel the wakeup; append a lifecycle event.
4. **Resume policy:**
   - `when-allowed` → `releaseIssue(run, { reenqueue: true })`: release the execution lock
     and enqueue a continuation run. The governor (cap resolver + future `executionState`)
     decides *when* it re-admits.
   - `no` → `releaseIssue(run, { reenqueue: false })`: release the lock but enqueue nothing.
     Work is parked until an operator or other trigger revives it (014-panic).
5. Return `{ outcome: "terminated", run }`.

### Soft mode (cannot kill a turn)

1. Load run; `noop` if not running.
2. `markSoftIntent(runId, reason, resume)` — persist the wind-down intent + resume policy on
   the running row (no process action).
3. The **existing natural-finish path** consults the intent when the turn completes:
   records `windDownReason`, and if `resume: "no"` skips promoting a continuation. Terminal
   status stays `finished`.
4. Return `{ outcome: "marked-soft", run }`.

### Crash safety — `wound-down-resume` reconcile source

A new `ReconcileSource` registered in the Phase-1 reconciler (`admission-reconciler.ts`,
which already accepts pluggable sources). Each pass: find runs with
`status = wound_down AND resumePolicy = 'when-allowed'` whose issue has no active/queued
continuation run, and re-enqueue them. This covers a crash between terminate and enqueue,
and is the first new source plugging into the Phase-1 reconciler seam (2a's cost/wall-clock
counters follow the same shape). Runs with `resumePolicy = 'no'` are left untouched.

## Resume fidelity (known risk, accepted)

Resume relies on the persisted Claude Code session plus the continuation-summary doc.
Mid-run, the durable session pointer may only be `sessionIdBefore`; `sessionIdAfter` is
written on clean completion. If a turn spawned a fresh session, resuming could lose the
interrupted turn's partial progress. The grace window *may* let the adapter flush
`sessionIdAfter`, but that is adapter-specific.

**Mitigation (accepted):** on hard wind-down, capture whatever session id is live **and**
always write the continuation-summary doc as a non-destructive fallback. Verify actual
per-adapter resume behavior during implementation rather than blocking the design on it.
Worst case, resume falls back to the (coarse but non-destructive) continuation summary.

## Schema changes

One numbered migration under `packages/db/src/migrations/`, editing
`packages/db/src/schema/heartbeat_runs.ts`:

- `windDownReason` — nullable `text`.
- `resumePolicy` — nullable `text` (`'when-allowed' | 'no'`).
- `status` — no migration for the new value itself (free-text column); `wound_down` is
  added to the TypeScript status handling and to any status-set/notify code paths.

## Testing (TDD, integration-level: real db, faked process kill)

| Case | Expectation |
|------|-------------|
| `hard` + `when-allowed` | status `wound_down` + reason; continuation captured; a queued continuation run exists for the issue |
| `hard` + `no` | status `wound_down` + reason; continuation captured; **no** queued continuation; execution lock released |
| `soft` + `no` | run left running; on simulated natural finish → `finished` + reason, no continuation promoted |
| `soft` + `when-allowed` | on simulated natural finish → `finished`, normal promotion |
| already finished/cancelled | `{ outcome: "noop" }`, no side effects |
| reconcile source | orphaned `wound_down`+`when-allowed` issue re-enqueued; `wound_down`+`no` left alone |

Tests drive `windDownRun` directly (no HTTP surface). Write failing tests first per TDD.

## Files touched

- `server/src/services/run-wind-down.ts` — **new**, the primitive.
- `server/src/services/heartbeat.ts` — wire concrete `WindDownDeps`; add `wound_down` to
  status handling; consult soft-intent in the natural-finish path.
- `server/src/services/admission-reconciler.ts` — register the `wound-down-resume` source
  (or add it to the phase source list assembled where the reconciler is constructed).
- `packages/db/src/schema/heartbeat_runs.ts` + a new migration — the two columns.
- Tests colocated with the above.
