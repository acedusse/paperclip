# Design: Predictive Budget Circuit Breaker (Combo 01, Phase 3a)

Companion to the combo plan [`combo-01-runtime-control-plane.md`](../../../.ideas/combinations/combo-01-runtime-control-plane.md)
and its [corrected phasing](../../../.ideas/combinations/combo-01-phasing-corrected.md). This is
sub-phase **3a** of Phase 3; sub-phase 3b (Spend-Schedule / Quiet Hours, idea 005) is a separate
spec. Builds on the Phase 1 cap-resolver seam and the Phase 2 wind-down primitive.

Implements idea **002** (Predictive Budget Circuit Breaker) and the auto-drain half of idea **014**.

## Problem

Nothing stops a company from burning through its budget between manual check-ins. Budgets today are
enforced only *reactively* — `budgetService` pauses a scope after it has already crossed a threshold.
There is no forecast, no graduated slow-down, and no automatic wind-down under runaway spend. This is
the combo's headline justification: automated runaway-spend protection.

## Scope

- **In:** a per-company forecast (`timeToLimit = remaining budget ÷ rolling burn rate`), a graduated
  warn → throttle → halt response expressed as a cap writer, anti-oscillation hysteresis, self-releasing
  recovery, and an auto-drain (wind-down) of in-flight runs at the HALT rung.
- **Out (deferred):** instance-scope forecasting (no instance budget exists), per-band operator config
  (only enable + horizon are exposed; the rest are derived constants), true run-criticality tiers
  ("pause non-critical" is approximated by the existing priority-ordered claim), and idea 005's
  time-window schedule writer (sub-phase 3b).

## Design decisions (locked)

1. **Company scope only.** Budgets are `company | agent | project`, metric `billed_cents`, window
   `calendar_month_utc | lifetime` — there is no instance budget. The breaker forecasts against the
   **company-scoped `billed_cents` policy** and acts at the resolver's company site. Instance sites are
   untouched.
2. **Eligibility:** a company is evaluated only if `predictiveBreakerEnabled` **and** it has at least one
   active company-scoped `billed_cents` budget policy with a finite (`amount > 0`) budget. When more than
   one such policy exists (e.g. a monthly *and* a lifetime cap), the forecast uses the **most urgent** —
   the policy with the smallest `timeToLimit`. Otherwise the writer gives no opinion and the configured
   default wins.
3. **Three-rung ladder:** WARN (event only) → THROTTLE (reduced cap) → HALT (cap 0 + wind-down).
4. **Hysteresis is mandatory:** escalate immediately on crossing a down-threshold; de-escalate only when
   `timeToLimit` recovers past a **+50%-gapped** up-threshold **and** the current level has been held for
   at least `minDwell` (10 min). State `{level, since}` is persisted so dwell survives crashes.
5. **Auto-release:** the breaker de-escalates out of HALT on its own (HALT→THROTTLE→normal), each step
   gated by the up-threshold + dwell. No human needed. Ramp-back is bounded by the throttle cap, so there
   is no stampede.
6. **The breaker owns its own reversible cap and its own wind-down — it does NOT flip
   `runExecutionState`.** Manual panic/drain stays human-owned. Because `panic-drain` outranks
   `predictive-breaker` in the frozen precedence, a human panic always wins over the breaker, the breaker
   can never auto-release a human's drain, and the breaker's wind-down is attributed distinctly.
7. **Minimal config:** per-company `predictiveBreakerEnabled` + `breakerHorizonMinutes`; instance
   `general` carries the same two as inherited defaults. Everything else is a derived constant.

## The forecast (burn signal)

Computed on-demand each heartbeat tick — no new aggregation infrastructure; the existing
`(company_id, occurred_at)` index on `cost_events` supports the windowed sum.

```
burnRate   = SUM(cost_events.cost_cents WHERE company_id = C AND occurred_at >= now - W) / W_minutes
             // cents per minute; W = burnWindow (15 min constant)
remaining  = budgetAmount - observedSpend      // reuse budgetService's window computation
timeToLimit = burnRate > 0 ? remaining / burnRate : Infinity   // minutes
```

`remaining <= 0` is treated as an immediate HALT trigger regardless of burn rate.

## The ladder

`H = breakerHorizonMinutes`. Down-thresholds (escalate immediately on cross):

| Condition                          | Level     | Cap effect                               |
| ---------------------------------- | --------- | ---------------------------------------- |
| `tt > 2H`                          | normal    | writer no-opinion (`null`)               |
| `tt <= 2H`                         | WARN      | event only, cap unchanged (`null`)       |
| `tt <= H`                          | THROTTLE  | `max(1, floor(configuredCap * 0.5))`     |
| `tt <= H/4` **or** `remaining<=0`  | HALT      | `0` + wind down in-flight runs           |

Up-thresholds (de-escalate only when **both** hold: `tt >` gapped threshold **and** dwell `>= minDwell`),
gap factor `upGap = 1.5`:

| From      | To        | Release condition                          |
| --------- | --------- | ------------------------------------------ |
| HALT      | THROTTLE  | `tt > (H/4) * 1.5` and held `>= 10 min`    |
| THROTTLE  | WARN      | `tt > H * 1.5` and held `>= 10 min`        |
| WARN      | normal    | `tt > 2H * 1.5`                            |

**De-escalation is one rung per evaluation**, each step gated by that rung's own dwell. So recovery from
HALT is deliberately gradual — HALT→THROTTLE→WARN→normal across successive ticks (≈30 min minimum, given
the 10-min dwell), and the cap rises monotonically as the level falls. Escalation, by contrast, may jump
straight to the deepest rung the current `tt` warrants in a single tick.

**Derived constants (single source in code):** `warnMult 2`, `throttleMult 1`, `haltMult 0.25`,
`throttleFactor 0.5`, `throttleUncappedCap 2`, `minDwell 10 min`, `burnWindow 15 min`, `upGap 1.5`.

"Pause non-critical" is approximated: while THROTTLE lowers the cap, the Phase-2 priority-ordered claim
loop already starts only the highest-priority waiting runs first.

## Architecture — mirrors `panicDrainWriter`

Enforcement is split the same way Phase 2c split panic/drain: a **stateful evaluator** that decides and
persists the level, and a **pure writer** that reads the persisted level and returns a cap. `resolve()`
stays side-effect-free and synchronous; the 4 resolver call sites keep their shape.

### Persisted state — `company_breaker_state` table

A dedicated table (not columns on `companies`) keeps the wide `companies` table lean; a row exists only
for a company the breaker has evaluated.

```
company_breaker_state
  company_id            text PK  -> companies.id (cascade delete)
  level                 text NOT NULL DEFAULT 'normal'   -- normal|warn|throttle|halt
  since                 timestamptz NOT NULL             -- when the current level was entered (dwell)
  last_burn_rate_cpm    double precision                 -- cents/min, observability
  last_time_to_limit_m  double precision                 -- minutes, observability (null = Infinity)
  updated_at            timestamptz NOT NULL
```

### Breaker evaluator (service, runs on the heartbeat admission tick)

For each eligible company:

1. Compute `burnRate`, `remaining`, `timeToLimit`.
2. Load persisted `{level, since}` (default `normal`).
3. Apply the ladder + hysteresis → `nextLevel` (escalate immediately; de-escalate only if gapped
   up-threshold **and** dwell satisfied).
4. If `nextLevel != level`: persist the new `{level, since: now}`, emit an activity-log transition event
   `{from, to, burnRate, timeToLimit, remaining}`. Always refresh `last_burn_rate_cpm` /
   `last_time_to_limit_m` / `updated_at`.
5. If `nextLevel == HALT`: wind down the company's in-flight runs via the Phase-2 primitive with
   `reason: "predictive-breaker-halt"`, `resume: when-allowed` (idempotent — already-wound-down runs are
   skipped).

Piggybacking the existing admission pass (not a separate timer) means the breaker's cadence matches
admission decisions and needs no new scheduler.

### `predictiveBreakerWriter` (effective-cap-resolver.ts)

Registered at the reserved `predictive-breaker` slot. Reads the level from an extended `CapContext` and
maps it to a cap:

```ts
CapContext.breakerLevel?: BreakerLevel  // "normal" | "warn" | "throttle" | "halt"

predictiveBreakerWriter.resolve(ctx):
  switch (ctx.breakerLevel) {
    case "halt":     return 0;
    case "throttle": return ctx.configuredMax == null
                          ? throttleUncappedCap                              // else throttle is a no-op
                          : Math.max(1, Math.floor(ctx.configuredMax * throttleFactor));
    default:         return null;   // normal | warn | undefined -> no opinion
  }
```

**Throttle must bite even with no configured cap.** A company can enable the breaker while leaving
concurrency uncapped (`configuredMax == null`). Returning `null` there would make THROTTLE a silent
no-op and effectively jump the ladder from WARN straight to HALT. So an uncapped company throttles to a
fixed `throttleUncappedCap` (constant, default `2`) — slowing burn without slamming to a single run.
HALT still returns `0` regardless.

The company resolver site loads the persisted level (like it loads `executionState` today) and passes it
in. Instance sites pass no `breakerLevel` → writer no-opinion. The writer set becomes
`[panicDrainWriter, predictiveBreakerWriter, configuredDefaultWriter]` (a `PHASE3_WRITERS` /
extended set; company sites use it, instance sites may keep the lighter set since the breaker is
company-only).

## Auto-drain (completes 014), separated from manual panic

- HALT does **not** write `runExecutionState`. It returns cap 0 (writer) **and** winds down in-flight
  runs (evaluator) with its own attributed reason.
- The manual panic/drain state machine (`panicDrainWriter` reading `runExecutionState`) is unchanged and
  outranks the breaker. Consequences: a human panic wins over the breaker; the breaker can't clear a
  human's drain; the breaker's wind-down is attributable and independently reversible.
- Recovery: as the level de-escalates the cap rises, and runs wound down `when-allowed` resume — bounded
  by the throttle cap first, so recovery ramps rather than stampedes.

## Config & propagation

- **Shared types / schema:** per-company `predictiveBreakerEnabled: boolean` and
  `breakerHorizonMinutes: number` (positive int). Instance `general` gains the same two as defaults.
- **Resolution:** company value if set, else instance default, else breaker disabled. Carried through
  `normalizeGeneralSettings` (else `.strip()` drops the instance keys) — same pitfall handled in 2b/2c.
- **Company storage:** real columns on `companies` (`predictive_breaker_enabled boolean NOT NULL DEFAULT
  false`, `breaker_horizon_minutes integer`). Instance storage: keys in the `general` JSONB.

## Observability & operator surface

- `AdmissionStatus` gains `breakerLevel: BreakerLevel` (default `normal`); `source` already reports the
  winning writer, so it reads `"predictive-breaker"` when the breaker sets the cap.
- Activity-log event on every level transition (fields above) — the audit trail for automated cap moves.
- **UI:** `AdmissionStatusLine` renders a breaker badge when `breakerLevel !== "normal"` (mirrors the
  drain badge). Company + instance settings pages get the enable toggle + horizon input beside the
  existing admission controls.

## Schema changes

Hand-written migration **`0111`** (drizzle-kit unusable past `0098`; add `.sql` + `_journal.json` entry):

- `ALTER TABLE companies ADD COLUMN predictive_breaker_enabled boolean NOT NULL DEFAULT false`,
  `ADD COLUMN breaker_horizon_minutes integer`.
- `CREATE TABLE company_breaker_state (...)` as above.
- Instance config lives in the existing `general` JSONB (no migration).

## Testing

- **Unit — ladder:** each down-threshold maps to the right level; `remaining <= 0` forces HALT; the
  most-urgent (min-`tt`) policy wins when several are active; writer maps level→cap (halt 0, throttle
  `max(1, floor(cfg×0.5))` with a configured cap, throttle → `throttleUncappedCap` when `configuredMax`
  is null, normal/warn/undefined → null).
- **Unit — hysteresis:** escalation is immediate; de-escalation blocked until BOTH the gapped
  up-threshold and `minDwell` are met; dwell measured from persisted `since` (survives a simulated
  restart).
- **Unit — config normalize:** instance `general` round-trips the two keys through
  `normalizeGeneralSettings`; company-null inherits the instance default.
- **Integration:** seed `cost_events` to force a burn rate, drive the evaluator across ticks against an
  embedded budget policy — assert the cap drops to the throttle value *before* the budget wall; assert no
  oscillation when burn jitters around a threshold (level holds through dwell); assert HALT winds down
  in-flight runs and then auto-releases (cap rises) once burn subsides past the gapped up-threshold.
  (Integration may skip without embedded Postgres, per existing suites.)

## Files touched (anticipated)

- `packages/db/src/migrations/0111_predictive_breaker.sql` + `_journal.json`; `companies` +
  `company_breaker_state` in the db schema.
- `packages/shared` — `BreakerLevel` enum, breaker config on instance + company types, `general` schema.
- `server/src/services/effective-cap-resolver.ts` — `predictiveBreakerWriter`, `CapContext.breakerLevel`,
  extended writer set.
- `server/src/services/predictive-breaker.ts` (new) — forecast + hysteresis evaluator + state I/O +
  wind-down trigger.
- `server/src/services/budgets.ts` / `costs.ts` — a small exported `windowedBurnRate` / remaining helper
  if not already reusable.
- `server/src/services/heartbeat.ts` — invoke the evaluator on the admission tick; load `breakerLevel`
  into the company resolver sites; extend `AdmissionStatus`.
- `ui/src/components/AdmissionStatusLine.tsx`, `ui/src/pages/CompanySettings.tsx`,
  `ui/src/pages/InstanceGeneralSettings.tsx` (+ their tests).
