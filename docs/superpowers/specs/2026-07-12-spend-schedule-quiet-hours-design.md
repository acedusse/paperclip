# Design: Spend-Schedule / Quiet Hours + Manual Override (Combo 01, Phase 3b)

Companion to the combo plan [`combo-01-runtime-control-plane.md`](../../../.ideas/combinations/combo-01-runtime-control-plane.md)
and its [corrected phasing](../../../.ideas/combinations/combo-01-phasing-corrected.md). This is
sub-phase **3b** of Phase 3; sub-phase 3a (Predictive Budget Circuit Breaker) is a
[separate spec](2026-07-11-predictive-budget-circuit-breaker-design.md) and is already built. Builds
on the Phase 1 cap-resolver seam and reuses the timezone-aware cron primitives in `cron.ts` /
`routines.ts`.

Implements idea **005** (Spend-Schedule / Quiet Hours Profiles) and delivers the previously-unbuilt
`manual-override` cap writer (nominally a Phase 1 deliverable, deferred until now).

## Problem

Autonomy is "always on," but an operator's tolerance for spend and concurrency is not constant through
the day. They may want a company to run hard overnight (cheap, nobody watching, big batch work) and
throttle during the workday (so output can be reviewed before more piles up), or pause entirely during
a demo. Today the only levers are blunt: pause an agent, or hit the budget wall. There is no
time-of-day cap control and no one-click "boost / quiet now."

## Scope

- **In:**
  - A per-company set of **time-window profiles**, each imposing a `maxConcurrentRuns` cap, evaluated
    live against the company's timezone at each admission tick (stateless — no fired routine, no
    persisted schedule state). Registers as the `schedule` cap writer.
  - A **manual override** — one-click "boost for N hours" / "quiet now for N hours" that temporarily
    supersedes the schedule and the configured default, with lazy auto-revert. Fills the reserved
    `manual-override` cap-writer slot.
  - Timezone/DST correctness (company-level tz), midnight-wrapping windows, most-restrictive-wins
    overlap resolution, a next-transition readout, and frontend preset templates.
- **Out (deferred):**
  - **Per-window burn ceiling (`maxBurnPerHour`).** The effective-cap resolver produces a concurrency
    slot count only; there is no spend-pace enforcement plane. Reactive burn protection is already owned
    by the Phase-3a predictive breaker. Windows express spend intent through concurrency alone.
  - **Instance-scope schedules.** Idea 005 stores the operator's tz on the *company*; schedule and
    manual override are company-only, exactly like the breaker (instance sites keep the lighter writer
    set).
  - **Routine-fired schedule execution.** We reuse the cron/timezone *primitives*, not the routine
    *execution* machinery — see "Evaluation model."

## Design decisions (locked)

1. **Two writers, filling the two empty precedence slots.** The frozen order is unchanged:

   ```
   panic-drain > predictive-breaker > manual-override > schedule > configured-default
   ```

   A manual **boost** therefore cannot override a breaker THROTTLE/HALT or a human panic/drain — safety
   writers outrank operator convenience by construction. A manual override *can* exceed the configured
   default (that is the "run hard now" case) and *can* undercut it ("quiet now").

2. **Concurrency cap only.** Each window sets `maxConcurrentRuns` (the value the resolver already
   produces). No `maxBurnPerHour`. Fewer slots is the schedule's spend lever; the breaker handles true
   burn-rate protection.

3. **Stateless on-demand evaluation.** At each admission tick, the currently-active cap is computed from
   `(windows, company tz, now)` and injected into `CapContext`. No persisted "current schedule cap," no
   fired routine action. DST-correct by construction (re-evaluated live each tick); a missed tick can
   never leave a stale cap. Mirrors how the breaker level is loaded and passed in — except the schedule
   needs no DB state at all beyond its config.

4. **Most-restrictive-wins on overlap.** When several windows are active at the same instant, the
   **lowest** `maxConcurrentRuns` applies. A "Paused" (cap 0) window therefore always dominates its
   overlap. Spend-safe by default, deterministic, and needs no per-window priority UI.

5. **Windows are exceptions to the default.** Outside every window the `schedule` writer gives no
   opinion (`null`) and the configured default (or a higher-precedence writer) wins. There is no
   implicit "all day" window.

6. **Manual override is transient with lazy auto-revert.** Stored as a cap + an expiry timestamp; the
   override is in force only while `expires_at > now`. Expiry is evaluated at read — no timer, no
   sweeper. Setting a new override replaces any existing one.

7. **Company scope, JSONB config.** The window list is config (operator-authored), not mutable
   evaluator state, so it lives in a JSONB column on `companies` (atomic read with the company row
   heartbeat already loads — no extra query per tick, no join). This differs from 3a's
   `company_breaker_state` table, which held *mutable* evaluator state; there is no equivalent mutable
   state here.

## Data model

### Company columns (migration `0112`)

All on `companies` (no new table):

```
schedule_windows              jsonb NOT NULL DEFAULT '[]'::jsonb   -- ScheduleWindow[]
schedule_timezone             text                                 -- IANA tz; null => schedule inert
manual_cap_override           integer                              -- forced cap while unexpired (>=0)
manual_cap_override_expires_at timestamptz                         -- auto-revert instant
```

### `ScheduleWindow` (shared zod schema)

```ts
ScheduleWindow {
  id: string                 // stable client-generated id (for UI CRUD / diffing)
  label: string              // operator-facing, e.g. "Business hours"
  days: number[]             // weekdays 0–6 (Sun=0 … Sat=6), non-empty, unique —
                             //   matches getZonedMinuteParts / cron.ts weekday convention
  startMinute: number        // minute-of-day 0..1439, in company tz
  endMinute: number          // minute-of-day 0..1439; if endMinute <= startMinute the window
                             //   wraps past midnight into the next day
  maxConcurrentRuns: number  // >= 0; 0 = paused
}
```

**Validation:** `days` non-empty and each in `0..6`; `startMinute`/`endMinute` in `0..1439`;
`maxConcurrentRuns >= 0`; `schedule_timezone` valid per the existing `assertTimeZone` when any window
exists; a bounded maximum window count (e.g. 24) to keep per-tick evaluation cheap.

> **No empty window; the `start === end` full-day form.** Because `endMinute <= startMinute` is
> defined as "wrap past midnight," a `start === end` pair means the window covers the full 24 hours on
> its `days` — it is **never** interpreted as empty. This makes every `(startMinute, endMinute)` pair
> meaningful, so validation has no "zero-length" case to reject, and the canonical "paused all day"
> window is simply `startMinute: 0, endMinute: 0` (or any equal pair) with `maxConcurrentRuns: 0`.

## Evaluation model

New pure module `server/src/services/schedule-cap.ts`, reusing the zoned-time helpers already in
`cron.ts` / `routines.ts` (`getZonedMinuteParts`-style weekday+minute extraction, `assertTimeZone`).

### `activeScheduleCap(windows, timezone, now): number | null`

1. If `timezone` is null/empty or `windows` is empty → `null` (no opinion).
2. Resolve `now` into the company tz: `{ weekday (1–7), minuteOfDay (0–1439) }`.
3. A window is **active** iff `weekday ∈ window.days` **and** the minute-of-day falls in its range:
   - Non-wrapping (`startMinute < endMinute`): `startMinute <= minuteOfDay < endMinute`.
   - Wrapping (`endMinute <= startMinute`): `minuteOfDay >= startMinute` **or** `minuteOfDay <
     endMinute`. For the day-membership check of the wrapped tail (after midnight), the window's `days`
     are interpreted as the days on which the window *starts*; the post-midnight tail belongs to the
     start day's window. (Concretely: a Fri 22:00→02:00 window is active Fri 22:00–23:59 and
     Sat 00:00–01:59, and `days` lists Friday.) This start-day rule is applied by also testing the
     previous day's membership for the wrapped tail.
4. Among all active windows, return `min(maxConcurrentRuns)` (most-restrictive-wins). No active window
   → `null`.

### `activeManualOverride(company, now): number | null`

Return `manual_cap_override` iff it is non-null **and** `manual_cap_override_expires_at > now`;
otherwise `null`. (Expired rows may be lazily cleared on the next company write, but correctness does
not depend on it — the read-time check is authoritative.)

### `nextScheduleTransition(windows, timezone, now): { at: Date; cap: number | null } | null`

Forward-scan minute-by-minute from `now` up to a bounded horizon (8 days) for the first minute at which
`activeScheduleCap` returns a different value, reusing the same zoned-minute logic. Returns that
boundary instant and the cap that takes effect, or `null` if the schedule never changes within the
horizon (empty/constant schedule). Drives the operator readout ("throttles to 4 runs at 9:00am").
Forward-scanning in UTC and re-deriving zoned parts each step deliberately sidesteps error-prone
reverse-timezone (zoned→UTC) conversion across DST. The scan is bounded (≤ 8×1440 iterations against a
cached `Intl` formatter) and runs only on the **pollable status endpoint**, never in the hot admission
gate, so its cost is immaterial.

## The writers (`effective-cap-resolver.ts`)

Both are pure and read pre-computed values from an extended `CapContext`, exactly like
`predictiveBreakerWriter` reads `breakerLevel`. `resolve()` stays synchronous and side-effect-free; the
computation lives at the resolver call site.

```ts
CapContext.manualOverrideCap?: number | null;  // slot "manual-override"
CapContext.scheduleCap?:       number | null;  // slot "schedule"

manualOverrideWriter.resolve = (ctx) => ctx.manualOverrideCap ?? null;
scheduleWriter.resolve       = (ctx) => ctx.scheduleCap ?? null;
```

Writer set at company sites becomes:

```ts
PHASE3B_COMPANY_WRITERS = [
  panicDrainWriter,
  predictiveBreakerWriter,
  manualOverrideWriter,
  scheduleWriter,
  configuredDefaultWriter,
];
```

This replaces `PHASE3_COMPANY_WRITERS` at the company resolver sites. Instance sites keep
`PHASE1_WRITERS` (no budget/breaker, no schedule/override). The `CAP_WRITER_PRECEDENCE` array is
already frozen with both `manual-override` and `schedule` in place; the existing precedence-assertion
test is extended to cover the two newly-real writers (their `precedence` = `indexOf(name)`).

## Heartbeat wiring

On the admission tick, per company (the company row — with the new columns — is already loaded where
`maxConcurrentRuns` / `runExecutionState` are read):

```ts
ctx.manualOverrideCap = activeManualOverride(company, now);
ctx.scheduleCap       = activeScheduleCap(company.scheduleWindows, company.scheduleTimezone, now);
```

Both are O(windows) pure computations, evaluated once per company per tick (matching the breaker's
"evaluate once per company per tick" discipline). No new timer or scheduler.

## Config & propagation

- **shared:** `ScheduleWindow` type + zod schema; the four company fields added to the company type and
  its validators. Company-update accepts and persists `scheduleWindows` / `scheduleTimezone` (mirrors
  how 3a threaded `predictiveBreakerEnabled` / `breakerHorizonMinutes` through company update). The
  general-settings normalize pitfall from 2b/2c/3a does **not** apply — these are company columns, not
  instance `general` JSONB keys.
- **Manual-override endpoints (company-scoped):**
  - `POST /companies/:id/cap-override` `{ cap: number >= 0, durationMinutes: number > 0 }` — sets
    `manual_cap_override` and `manual_cap_override_expires_at = now + duration`. Emits an activity-log
    event. Serves both "boost" (`cap` high) and "quiet now" (`cap` 0/low).
  - `DELETE /companies/:id/cap-override` — clears both columns immediately. Emits an activity-log event.

## Presets (frontend-only)

The four presets from idea 005 are **UI templates** that populate the window editor before save; the
backend has no preset concept.

- **Always full** — clears all windows (schedule inert; configured default rules).
- **Nights & weekends only** — restrictive windows over business hours Mon–Fri.
- **Business-hours throttle** — a reduced-cap window Mon–Fri 09:00–17:00.
- **Paused** — one full-day (wrapping) window, cap 0, all days.

## Observability & operator surface

- **`AdmissionStatus`** already reports the winning writer in `source`; it reads `"schedule"` or
  `"manual-override"` live when either sets the cap. Add `scheduleNextTransition?: { at, cap }` from
  `nextScheduleTransition` for the readout.
- **Activity log:** an event on manual-override set and clear (operator audit for a cap move). Schedule
  transitions are deterministic from config and surfaced live via `source` + the next-transition
  readout, so they need no per-boundary event.
- **UI:**
  - `CompanySettings` — a schedule editor (timezone picker; window CRUD with day/time/cap inputs;
    preset buttons) and manual-override controls ("Boost for [2h]" / "Quiet now for [2h]" / "Clear"),
    beside the existing admission + breaker controls.
  - `AdmissionStatusLine` — an active-window / override badge (mirrors the drain and breaker badges) and
    the next-transition line ("throttles to 4 runs at 9:00am").

## Schema changes

Hand-written migration **`0112`** (drizzle-kit unusable past `0098`; add `.sql` + `_journal.json`
entry, `idx: 112`):

- `ALTER TABLE companies`
  - `ADD COLUMN schedule_windows jsonb NOT NULL DEFAULT '[]'::jsonb`
  - `ADD COLUMN schedule_timezone text`
  - `ADD COLUMN manual_cap_override integer`
  - `ADD COLUMN manual_cap_override_expires_at timestamptz`
- No new table.

## Testing

- **Unit — `activeScheduleCap`:** inside vs outside a window; non-wrapping range boundaries
  (inclusive start, exclusive end); midnight-wrapping window active on both sides of midnight with
  correct start-day membership; overlap → `min` cap; a cap-0 window dominating an overlap; DST spring-
  forward / fall-back boundary correctness (window edge lands on the right wall-clock minute);
  null/empty tz → `null`; empty windows → `null`.
- **Unit — `activeManualOverride`:** active (unexpired) returns cap; expired returns `null`; absent
  returns `null`; boundary `expires_at === now` treated as expired.
- **Unit — `nextScheduleTransition`:** next edge computed across a day boundary and a week boundary;
  constant/empty schedule → `null`; cap reported is the one taking effect at the edge.
- **Unit — writers & precedence:** `manualOverrideWriter` / `scheduleWriter` map ctx → cap; precedence
  resolves manual-override over schedule over configured-default; breaker and panic-drain both beat
  manual-override; the frozen `CAP_WRITER_PRECEDENCE` array assertion covers the two new writers.
- **Unit — config validation:** invalid tz rejected; out-of-range `startMinute`/`endMinute`/`days`
  rejected; negative cap rejected; window-count cap enforced.
- **Integration:** drive the heartbeat admission pass across a simulated tz window boundary and assert
  the effective cap shifts at the edge; set a manual boost and assert it supersedes the active window;
  assert the boost auto-reverts to the window cap at expiry; assert a breaker THROTTLE still wins over a
  manual boost (precedence). (Integration may skip without embedded Postgres, per existing suites.)

## Files touched (anticipated)

- `packages/db/src/migrations/0112_spend_schedule.sql` + `_journal.json`; `companies` columns in the db
  schema.
- `packages/shared` — `ScheduleWindow` type + zod schema; the four company fields on company
  type/validators.
- `server/src/services/schedule-cap.ts` (new) — `activeScheduleCap`, `activeManualOverride`,
  `nextScheduleTransition`, reusing `cron.ts` zoned-time helpers.
- `server/src/services/effective-cap-resolver.ts` — `manualOverrideWriter`, `scheduleWriter`,
  `CapContext.scheduleCap` / `.manualOverrideCap`, `PHASE3B_COMPANY_WRITERS`; extend the precedence
  test.
- `server/src/services/heartbeat.ts` — compute + inject the two ctx fields at the company resolver
  sites; extend `AdmissionStatus` with `scheduleNextTransition`.
- `server/src/routes` (companies) — accept/persist schedule config on company update; `POST`/`DELETE`
  `/companies/:id/cap-override` endpoints + OpenAPI.
- `ui/src/pages/CompanySettings.tsx` — schedule editor, presets, manual-override controls.
- `ui/src/components/AdmissionStatusLine.tsx` — active-window/override badge + next-transition readout.
- Tests alongside each of the above.
