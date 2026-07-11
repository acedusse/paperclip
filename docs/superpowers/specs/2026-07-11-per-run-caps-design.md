# Design: Per-Run Resource Caps (Combo 01, Phase 2a)

- **Date:** 2026-07-11
- **Combo:** 01 — Unified Runtime Control Plane
- **Phase:** 2a — per-run wall-clock + cost ceilings (idea 024, first sub-phase).
- **Depends on:** Phase 2.0 wind-down primitive (merged — `heartbeat.windDownRun`).
- **Status:** Approved design, pre-implementation.

## Problem

A single runaway heartbeat run (one agent turn) can burn unbounded wall-clock time or
API cost. Phase 1 caps *concurrency*; budgets cap *total scope spend*; neither bounds a
single run. Phase 2a adds two per-run ceilings — `maxRunWallClockMs` and `maxRunCostCents` —
enforced by terminating the offending run through the already-merged `windDownRun`, so the
work checkpoints and resumes rather than dying.

## Scope

**In scope:** the two cap fields on instance + company config; stamping the effective
ceiling onto each run at claim; reactive cost enforcement; periodic wall-clock enforcement
with a reconcile-source backstop; full operator config surface (API + OpenAPI + UI);
integration + unit tests.

**Out of scope (Phase 2b):** `maxToolCalls` / step counts (uneven adapter coverage — deferred
per the corrected phasing). No Panic/Drain (that is Phase 2c).

## Design decisions (locked)

1. **Stamped-per-run.** Cap values resolve from instance + company config at claim time and
   are frozen onto the `heartbeat_runs` row. Enforcement and the reconciler read the stamped
   row value, immune to mid-run config edits.
2. **Resolution precedence:** `company ?? instance ?? null` (null = unlimited). A plain
   tightest-scope lookup — **not** the `PHASE1_WRITERS` cap-writer registry, which is specific
   to the concurrency cap's precedence stack.
3. **Enforcement split:** cost is checked **reactively** on each cost event (tightest money
   control); wall-clock is checked in a **periodic** reconcile sweep; the same sweep
   re-checks cost as a **crash-safe backstop** for both.
4. **Both cap types wind down with `resume: "when-allowed"`.** A capped run re-enqueues and
   its continuation gets a fresh per-run budget. Per-run caps bound a single turn; total
   spend is bounded separately by budgets + `continuationAttempt` limits.
5. **Full config parity** with `maxConcurrentRuns`: instance-settings + company settings API,
   OpenAPI, and UI inputs.

## Config storage (mirrors `maxConcurrentRuns` — asymmetric by design)

- **Company:** real integer columns `maxRunWallClockMs`, `maxRunCostCents` on `companies`
  (beside `budgetMonthlyCents`, `packages/db/src/schema/companies.ts:30`). Nullable = unset.
- **Instance:** keys inside the `general` JSONB blob — added to `instanceGeneralSettingsSchema`
  (`packages/shared/src/validators/instance.ts:41`) and carried through
  `normalizeGeneralSettings` (`server/src/services/instance-settings.ts:36,48`); the `.strip()`
  schema drops any field not listed there.
- **Validators/types:** `updateCompanySchema` (`validators/company.ts:52`) + `types/company.ts`;
  `instanceGeneralSettingsSchema` + `types/instance.ts`. Both use
  `z.number().int().positive().nullable().optional()`.
- **Routes/OpenAPI:** company PATCH (`routes/companies.ts:363`) spreads the patch — flows
  automatically; instance PATCH (`routes/instance-settings.ts:100`) validates the schema.
  OpenAPI (`routes/openapi.ts`) references the shared Zod schemas → auto-updates.

## Stamp-at-claim

Resolve the effective per-run caps once per agent-tick in `startNextQueuedRunForAgent`
(`heartbeat.ts:8289`, where instance + company concurrency caps already resolve), pass them
into `claimQueuedRun`, and add them to the queued→running guarded UPDATE `.set({...})`
(`heartbeat.ts:7426`). `startedAt` (set in that same UPDATE) is the wall-clock baseline.
New stamped columns: `heartbeat_runs.maxRunWallClockMs`, `heartbeat_runs.maxRunCostCents`
(nullable integers).

## New module: `server/src/services/run-caps.ts`

Pure + dependency-injected, following the `run-wind-down.ts` / `admission-reconciler.ts`
pattern. Contents:

- `resolveRunCaps(input: { company: RunCaps; instance: RunCaps }): RunCaps` — the
  `company ?? instance` reduction, where `type RunCaps = { maxRunWallClockMs: number | null;
  maxRunCostCents: number | null }`.
- `type RunCapViolation = { runId: string; reason: "cap-wallclock" | "cap-cost" }`.
- `evaluateRunCostCap(deps, runId)` — reads the stamped `maxRunCostCents`, sums the run's cost
  (`sumRunCostCents`), returns a violation or null. Used by the reactive path.
- `makeRunCapSweepSource(deps): ReconcileSource` (name `"run-cap-sweep"`) — each tick, finds
  `running` runs violating wall-clock (`now - startedAt > maxRunWallClockMs`) or cost, winds
  each down. Crash-safe backstop for both caps.
- Deps inject: `getStampedRunCaps(runId)`, `sumRunCostCents(runId)`, `findRunningRunsWithCaps()`,
  and `windDownRun(runId, opts)`.

`sumRunCostCents` clones the shape of `computeObservedAmount` (`budgets.ts:157`) filtered by
`eq(costEvents.heartbeatRunId, runId)` — indexed by `cost_events_company_heartbeat_run_idx`
(`schema/cost_events.ts:62`). No such single-run sum helper exists today.

## Enforcement wiring

- **Cost (reactive):** in the cost-record path (`costs.ts:113`, immediately after
  `budgets.evaluateCostEvent(event)` fires — same tick), call `evaluateRunCostCap` for
  `event.heartbeatRunId`; on violation →
  `windDownRun(runId, { mode: "hard", resume: "when-allowed", reason: "cap-cost" })`.
  Kept out of `budgets.ts` because a per-run cap is not a budget policy. `windDownRun` is
  injected into whichever service owns this call.
- **Wall-clock (periodic) + cost backstop:** `makeRunCapSweepSource(...)` added to the
  `runReconcile([...])` array in `server/src/index.ts:896`, alongside `phase1ReconcileSources`
  and the existing `makeWoundDownResumeSource`. Fires every `config.heartbeatSchedulerIntervalMs`.
  Overshoot on wall-clock is bounded by one interval (acceptable for a safety ceiling).

## windDownRun surface (merged, unchanged)

`heartbeat.windDownRun(runId, { mode, resume, reason })` — 2 args (deps pre-bound). Reasons
`"cap-wallclock"` and `"cap-cost"` are already reserved in `WindDownReason`
(`run-wind-down.ts:12`). Hard mode captures continuation, terminates, marks `wound_down`, and
re-enqueues when `resume === "when-allowed"`.

## Operator surface (full parity)

- `ui/src/pages/CompanySettings.tsx` — wall-clock/cost inputs (state seed, dirty check,
  `handleSaveGeneral` payload), mirroring the `maxConcurrentRuns` field at `:69/:97/:197`.
- `ui/src/pages/InstanceGeneralSettings.tsx` — same, mirroring `:93/:120`.
- `ui/src/api/companies.ts:59` — extend the update payload type.
- Empty input → `null` (unlimited), matching the existing `maxConcurrentRuns` handling.

## Schema changes

One hand-written migration (`0108_per_run_caps`, following the repo's post-`0098`
hand-authored convention — `drizzle-kit generate` is unusable here):

- `companies`: `max_run_wall_clock_ms integer`, `max_run_cost_cents integer`.
- `heartbeat_runs`: `max_run_wall_clock_ms integer`, `max_run_cost_cents integer` (stamped).
- Instance values live in the existing `general` JSONB — no column.

## Testing

- **Unit (`run-caps.test.ts`, injected fakes):** `resolveRunCaps` precedence
  (company wins / instance fallback / both null); `evaluateRunCostCap` (over → violation with
  `cap-cost`, under → null, null cap → null); `makeRunCapSweepSource` (wall-clock violation →
  windDown `cap-wallclock`; cost violation → windDown `cap-cost`; within limits → nothing;
  source name + drifted/repaired counts).
- **Integration (embedded Postgres):** stamp — claiming a run under configured caps freezes
  the resolved values onto the row; reactive cost — inserting cost events past the stamped cap
  triggers `windDownRun` (run ends `wound_down`, reason `cap-cost`); wall-clock sweep — a run
  backdated past its stamped wall-clock cap is wound down by one `runReconcile` pass with reason
  `cap-wallclock`; resolution — company override beats instance default.
- **Config plumbing:** a lightweight test that instance `updateGeneral` round-trips the two new
  fields (guards against the `.strip()` drop) and company PATCH persists them.

## Files touched

- `packages/db/src/schema/companies.ts`, `heartbeat_runs.ts` + migration `0108`.
- `packages/shared/src/validators/instance.ts`, `types/instance.ts`, `validators/company.ts`,
  `types/company.ts`.
- `server/src/services/instance-settings.ts` (normalize carry-through).
- `server/src/services/run-caps.ts` — **new** (primitive + reconcile source).
- `server/src/services/heartbeat.ts` (resolve + stamp at claim; expose sweep deps).
- `server/src/services/costs.ts` (reactive cost enforcement hook).
- `server/src/index.ts` (register `run-cap-sweep` source).
- `ui/src/pages/CompanySettings.tsx`, `InstanceGeneralSettings.tsx`, `ui/src/api/companies.ts`.
- Tests colocated with the above.
