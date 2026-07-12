# Design: Panic Stop + Drain (Combo 01, Phase 2c)

- **Date:** 2026-07-11
- **Combo:** 01 — Unified Runtime Control Plane
- **Phase:** 2c — manual Panic Stop + Drain (idea 014, manual half; auto-drain-under-burn is Phase 3).
- **Depends on:** Phase 1 admission seam + `effective-cap-resolver` (`panic-drain` precedence slot reserved); Phase 2.0 `windDownRun` (`panic`/`drain` reasons reserved).
- **Status:** Approved design, pre-implementation.

## Problem

Phase 1 caps *concurrency*; 2a/2b cap a single run's *wall-clock / cost / turns*. None gives an operator a **manual kill switch**. Under a runaway or during a deploy/incident, the operator needs to (a) stop the fleet from starting new work and, when necessary, (b) halt everything already in flight — reversibly, without destroying partial work. Phase 2c adds an instance- and company-level execution-state with two operator actions: **Drain** (stop new starts, let in-flight finish) and **Panic** (stop new starts + cancel in-flight, checkpointed and resumable), plus **Resume**.

## Scope

**In scope:** `runExecutionState` (`running`/`draining`/`halted`) on instance + company; a `panicDrainWriter` registered in the cap-writer stack; a defensive execution-state guard in the run-claim choke point; a scope-wide panic wind-down fan-out; a crash-safe reconcile source; operator state-setter API (instance + company) + UI control and live readout; tests.

**Out of scope:** auto-drain-under-burn (Phase 3 — needs the 002 predictive breaker); any change to per-agent pause or per-company archive (2c is the *fleet-execution-state* layer above them). No explicit resume-ramp writer (decision 2).

## Design decisions (locked)

1. **Panic is reversible.** Panic winds each in-flight run down with `windDownRun(id, { mode:"hard", resume:"when-allowed", reason:"panic" })` — partial work is checkpointed to the continuation summary and the run **re-enqueues**. The halt state holds it queued (cap 0); Resume re-admits it. (User decision 1.)
2. **Resume relies on the configured concurrency cap, no ramp writer.** Resume flips state→`running`; the existing Phase-1 per-tick admission (`budget = cap − running`) re-admits gradually when a concurrency cap is set. A stampede is only possible if the operator configured *no* cap at all — accepted for the MVP. (User decision 2.)
3. **Both instance + company scopes.** Instance state = global kill switch (cascades to every company via the admission gate's `min(instanceCap, companyCap)`); company state = quiesce one company. (User decision 3.)
4. **Two coordinated enforcement mechanisms** (both required — neither alone is sufficient):
   - **`panicDrainWriter`** forces the *batch* admission budget to 0 and makes the admission-status endpoints report `cap 0, source "panic-drain"` (observability).
   - **A guard in `claimQueuedRun`** holds runs queued on the *direct* claim path (`executeRun`→`claimQueuedRun`, used by process-recovery / scheduled-retry / direct-wakeup) that bypasses the budget gate. This is what makes the seam "the only path a run can start, including recovery/retry."
5. **Drain holds, it does not cancel.** Draining and halted both *block new starts*; only halted *cancels in-flight*. Held runs stay `queued` (not cancelled), so Resume recovers them.
6. **Naming.** The field is `runExecutionState` — both `executionState` (issue-workflow JSONB) and `executionMode` (instance restricted/unrestricted policy) are already taken.
7. **Fail-open under DB failure (accepted guarantee).** `isScopeQuiescing` and the admission count/state lookups fail *open*: a DB lookup error is treated as `running`. Consequence: during a DB outage a halted fleet can admit new runs until the DB recovers — the `panic-halt-sweep` reconcile source then converges it back to halted on a subsequent tick. **Panic is therefore best-effort under DB failure, eventually-consistent via the sweep.** This is deliberate: failing *closed* on the state check would let a transient blip wedge all normal admission (treat every scope as quiescing), a worse self-inflicted outage on the common path. (Reviewed + accepted 2026-07-11.)

## State model & storage (mirrors the 2a/2b config split)

- **Type (shared):** `RunExecutionState = "running" | "draining" | "halted"` + `runExecutionStateSchema = z.enum([...])`. Default/absent = `running`.
- **Company:** real column `run_execution_state text NOT NULL DEFAULT 'running'` on `companies` (beside `status`/`maxRunTurns`).
- **Instance:** `runExecutionState` key in the `general` JSONB — added to `instanceGeneralSettingsSchema` (`validators/instance.ts`) and **carried through `normalizeGeneralSettings`** (`instance-settings.ts`), else the storage `.strip()` drops it. Absent = `running`.
- **Effective state for a company** = most-severe(instance, company), severity `halted > draining > running`. Company-scope resolver sites and the claim guard use this effective value so an instance-wide halt is reflected honestly at the company scope (readout `source` + enforcement). Instance-scope sites use the instance state directly.

## Enforcement wiring

### `panicDrainWriter` (effective-cap-resolver.ts)

- Extend `CapContext` to `{ configuredMax: number | null; executionState?: RunExecutionState }`.
- Add a static writer (state flows via ctx, so the writer itself stays static and unit-testable):
  ```ts
  export const panicDrainWriter: CapWriter = {
    name: "panic-drain",
    precedence: CAP_WRITER_PRECEDENCE.indexOf("panic-drain"), // 0, top
    resolve: (ctx) =>
      ctx.executionState === "halted" || ctx.executionState === "draining" ? 0 : null,
  };
  export const PHASE1_WRITERS: CapWriter[] = [panicDrainWriter, configuredDefaultWriter];
  ```
- Thread `executionState` into the four `resolveEffectiveCap` call sites (`heartbeat.ts:7367,7383,8437,8448`): instance sites (7367, 8437) pass the instance state; company sites (7383, 8448) pass the effective most-severe(instance, company) state. When a scope is draining/halted, its cap resolves to `0`, so the "no cap configured" fast path (`heartbeat.ts:8454`) is bypassed and `budget = max(0, 0 − running) = 0` → `claimUpTo(0)` admits nothing.

### Claim guard (heartbeat.ts `claimQueuedRun`, beside the pause-hold gate ~7434)

- Before flipping `queued→running`, check the effective execution state for `run.companyId` (instance ∨ company draining/halted). If quiescing, **return the run unclaimed (still `queued`)** — the same "leave queued" contract the dependency-unresolved path already uses (`heartbeat.ts:8504`). Do **not** cancel. This covers the `executeRun` direct-claim path (`heartbeat.ts:8502`) that skips the budget gate.
- A small injected helper `isScopeQuiescing(companyId): Promise<boolean>` reads instance + company state (fail-open: on lookup error, treat as running so a transient DB blip never wedges the fleet).

## Panic fan-out & state machine (service)

A new service seam (in `heartbeat.ts`, exposed like `windDownRun`, or a small `run-execution-state.ts` pure module + wired deps):

- `setInstanceRunExecutionState(state)` / `setCompanyRunExecutionState(companyId, state)`:
  - Persist the new state.
  - If the **target is `halted`**, run the panic fan-out for the scope.
  - `draining` / `running`: persist only (blocking + resume come from the writer/guard and the existing cap).
- **Panic fan-out** `panicStopScope(scope)`: enumerate `running` runs in scope (`findRunningRunsInstanceWide` / `findRunningRunsForCompany` — row-returning variants of the existing count helpers, or reuse the shape of `findRunningRunsWithCaps`) and `windDownRun(id, { mode:"hard", resume:"when-allowed", reason:"panic" })` each. Idempotent: re-panicking a halted scope with no running runs is a no-op.
- Audit every transition + every wound-down run to `activity-log` (mirrors the admit/defer auditing from Phase 1). **Scope carve-out (accepted 2026-07-11):** `activity_log.companyId` is a NOT-NULL FK, so only **company-scope** transitions get an `activity_log` row. **Instance-scope** transitions are recorded via `logger.info` instead (the individual wound-down runs still land in each run's event log). Making instance transitions queryable in `activity_log` (nullable `companyId` or a dedicated instance-audit path) is a deferred follow-up, to be picked up if a queryable instance-panic audit trail becomes an operational requirement.

## Crash-safe backstop (reconcile source)

`makePanicHaltSweepSource(deps)` (name `"panic-halt-sweep"`), registered in the `runReconcile([...])` array in `server/src/index.ts` beside `makeRunCapSweepSource`:

- Each tick, for any scope whose effective state is **`halted`**, find still-`running` runs in that scope and wind them down (`panic`, `resume:"when-allowed"`).
- Converges after (a) a crash mid-fan-out, or (b) a run that reached `running` in a race with the halt. Only `halted` is swept — `draining` intentionally lets in-flight runs finish.
- Reuses the same enumeration + `windDownRun` deps as the reactive fan-out.

## Resume

Setting state→`running` persists the state; nothing else. On the next tick the `panicDrainWriter` returns `null` (no opinion) → the cap resolves to the configured default → the Phase-1 per-tick admission re-admits up to `cap − running`. Panicked runs were re-enqueued (`resume:"when-allowed"`) and are picked up by that same admission (and by the existing `wound-down-resume` reconcile source for any whose continuation wasn't scheduled). No new ramp code (decision 2).

## Operator surface

- **API (one state-setter per scope, side-effecting):**
  - `POST /companies/:companyId/execution-state` `{ state: RunExecutionState }` — validates via `runExecutionStateSchema`; calls `setCompanyRunExecutionState`. Placed beside the existing `/:companyId/admission-status` route.
  - `POST /instance/execution-state` `{ state }` — instance equivalent, beside `/instance/admission-status`.
  - OpenAPI references the shared Zod enum → auto-updates.
- **Admission status:** extend `AdmissionStatus` (returned by the admission-status endpoints) with `runExecutionState` so the UI can render "halted"/"N draining…" without a second request.
- **UI (`CompanySettings.tsx`, `InstanceGeneralSettings.tsx`):** a Running / Drain / **Panic** / Resume control (Panic confirms first — it cancels in-flight work) and a live state badge, extending `ui/src/components/AdmissionStatusLine.tsx` (already shows running/queued). Panic button styled destructive; a halted/draining scope shows the state + count.

## Schema changes

One hand-written migration (`0110_run_execution_state`, next after `0109`):

- `companies`: `run_execution_state text NOT NULL DEFAULT 'running'`.
- Instance value lives in the existing `general` JSONB — no column.
- (No `heartbeat_runs` column — panic uses the existing `wound_down` status + `windDownReason:"panic"`.)

## Testing

- **Unit (`effective-cap-resolver` test):** `panicDrainWriter` returns 0 for halted/draining, null for running; `resolveEffectiveCap` with the writer registered yields `{cap:0, source:"panic-drain"}` when halted and falls through to configured-default when running; `CAP_WRITER_PRECEDENCE` unchanged (panic-drain still index 0).
- **Unit (state machine / pure helpers):** most-severe effective-state resolution (instance-halt cascades over company-running; company-halt with instance-running); `isScopeQuiescing` truth table; fail-open on lookup error.
- **Unit (panic fan-out, injected fakes):** halted scope with N running runs → N `windDownRun(panic, when-allowed)` calls; empty scope → no-op; draining → no wind-down.
- **Unit (sweep source):** halted scope with a running run → wound down `panic`; draining scope → nothing; source name + drifted/repaired counts.
- **Integration (embedded Postgres):**
  - Drain a company → a subsequently-claimed run is **held queued** (not started), an already-running run is **untouched**; Resume → the held run starts.
  - Panic a company → running run ends `wound_down` (reason `panic`, resumable), new claims blocked; Resume → the run re-admits.
  - Instance halt cascades: a run in any company is blocked while instance = halted.
  - Claim-guard path: a run driven through `executeRun` directly (recovery/retry) is held when the scope is halted, proving the guard covers the non-budget path.
- **Config plumbing:** instance `updateGeneral` round-trips `runExecutionState` (guards the `.strip()` drop); company column persists + defaults to `running`.

## Files touched

- `packages/db/src/schema/companies.ts` + migration `0110`.
- `packages/shared/src/validators/instance.ts`, `types/instance.ts`, plus a shared `RunExecutionState` type + `runExecutionStateSchema` (e.g. `validators/run-execution-state.ts` or alongside company validators).
- `server/src/services/instance-settings.ts` (normalize carry-through).
- `server/src/services/effective-cap-resolver.ts` (`CapContext` + `panicDrainWriter` + `PHASE1_WRITERS`).
- `server/src/services/heartbeat.ts` (thread `executionState` into the 4 resolver sites; `claimQueuedRun` guard; `isScopeQuiescing`; panic fan-out + `set*RunExecutionState`; enumeration helpers; expose sweep deps).
- `server/src/services/run-execution-state.ts` — **new** (pure state-machine + sweep source, injected-deps pattern like `run-caps.ts`).
- `server/src/index.ts` (register `panic-halt-sweep`).
- `server/src/routes/companies.ts`, `server/src/routes/instance-settings.ts` (state-setter routes; extend `AdmissionStatus`).
- `ui/src/components/AdmissionStatusLine.tsx`, `ui/src/pages/CompanySettings.tsx`, `ui/src/pages/InstanceGeneralSettings.tsx`, `ui/src/api/companies.ts`.
- Tests colocated with the above.
