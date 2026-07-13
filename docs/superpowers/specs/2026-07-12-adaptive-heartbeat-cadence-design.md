# Design: Adaptive Heartbeat Cadence — Idle Backoff (Combo 01, Phase 4A-i)

Companion to [`combo-01-phasing-corrected.md`](../../../.ideas/combinations/combo-01-phasing-corrected.md)
(Track 4A) and idea [`035-adaptive-heartbeat-cadence.md`](../../../.ideas/035-adaptive-heartbeat-cadence.md).
This is the first, lowest-risk slice of 035: **idle backoff only.**

## Problem

Agents wake on a timer (`heartbeat.ts`) and check for work. Cadence is effectively fixed per
agent (`runtimeConfig.heartbeat.intervalSec`). An idle agent with an empty queue still wakes on
schedule, loads context, finds nothing to do, and sleeps again — pure token burn for zero output,
multiplied across a 24/7 fleet. A fixed interval can't serve both idle and busy agents well.

Idle backoff cuts that waste directly: after consecutive empty heartbeats, lengthen the agent's
effective wake interval (capped), while keeping the agent instantly reachable through the existing
event-driven wakeup path so new work still pulls it in immediately.

## Scope

**In**
- Per-agent idle backoff: after consecutive *empty* timer heartbeats, exponentially lengthen the
  effective interval up to an operator cap; snap back to the base interval the instant a productive
  heartbeat or an event-driven wake occurs.
- Per-agent operator config (`enabled`, `multiplier`, `maxIntervalSec`).
- A read-only "current cadence and why" readout (`idle ×6 → backed off to 30m`).

**Out (deferred to later 035 slices)**
- Speed-up-under-load (shorten interval on deep/urgent backlog).
- Per-tier / team-level bounds and instance-level default toggle.
- Activity-log entries for cadence transitions.

**Not built (already exists)**
- Event-driven wake responsiveness. Event wakes (`enqueueWakeup` from assignment, mention, blocker
  cleared, on-demand) do **not** pass through the timer gate, so a backed-off agent already responds
  instantly. This slice *preserves* that property; it does not add it.

## Design decisions (locked)

1. **The idle signal is the run outcome, not a tick-time proxy.** "Empty heartbeat" = a
   **timer-sourced** heartbeat run that completed **without concrete progress**, reusing the existing
   liveness classification (`heartbeatRuns.livenessReason` / "ended without concrete progress"). A run
   that made concrete progress (started/advanced an issue, produced work) is **productive**. Keying off
   the outcome — not "no assigned actionable issue at tick time" — means an agent that legitimately
   generates its own work is never throttled as if idle. *The exact predicate (which completed-run
   fields definitively mark "no concrete progress") is confirmed against the liveness classifier during
   planning.*
2. **State reuses the existing per-agent write seam (Approach C).** One integer column
   `agents.heartbeat_idle_streak`, updated inside `finalizeAgentStatus` (which already stamps
   `lastHeartbeatAt` on every run completion). No new table, O(1) reads, effective interval derived on
   the fly from `streak + config`.
3. **Anti-oscillation by asymmetry, not a hysteresis band.** Growth is gradual (one multiplier step
   per empty heartbeat); collapse is instant-to-base on any productive heartbeat or event wake. Because
   the signal is discrete per-heartbeat (unlike the predictive breaker's noisy continuous burn rate),
   this monotone-up / snap-down asymmetry is sufficient; no separate cooldown band is introduced. This
   is a deliberate departure from idea 035's "hysteresis/smoothing" phrasing, justified by the discrete
   signal.
4. **Opt-in per agent.** `enabled` defaults to `false`, so existing agents keep today's exact cadence
   until an operator turns backoff on. Instance-level defaults are deferred.

## Data model

### Agent column (migration `0113`)

```
ALTER TABLE agents ADD COLUMN heartbeat_idle_streak integer NOT NULL DEFAULT 0;
```

`heartbeat_idle_streak` is hot, self-healing state: a stale value at worst causes one mistimed wake
and is corrected on the next heartbeat, so it needs no reconciler participation.

### Config (`runtimeConfig.heartbeat.idleBackoff`, shared zod schema)

```ts
idleBackoff: {
  enabled: boolean;          // default false
  multiplier: number;        // default 2, must be > 1
  maxIntervalSec: number;    // cap; must be >= base intervalSec
}
```

Parsed alongside the rest of the heartbeat policy in `parseHeartbeatPolicy`, validated in
`packages/shared` and threaded through the agent normalize path (mirroring the predictive-breaker
config plumbing). Absent/invalid config resolves to `enabled: false` (no backoff).

## Evaluation model

### `effectiveIntervalSec(base, streak, cfg): number` (pure, new module `heartbeat-cadence.ts`)

```
if (!cfg.enabled) return base;
return Math.min(base * cfg.multiplier ** Math.max(0, streak), cfg.maxIntervalSec);
```

- `base = policy.intervalSec` (the configured interval; the floor).
- `streak = 0` → `base`. Each empty heartbeat raises the exponent by one; clamped at
  `maxIntervalSec`.
- Disabled → identical to today's behavior.

### Streak transitions

| Event | Location | Effect |
|-------|----------|--------|
| Empty timer heartbeat completes | `finalizeAgentStatus` | `streak += 1` |
| Productive timer heartbeat completes | `finalizeAgentStatus` | `streak = 0` |
| Non-timer (event) wake enqueues a run | `enqueueWakeup` path | `streak = 0` |

## Scheduler wiring

The **only** change in `tickTimers` is the due check:

```
- if (elapsedMs < policy.intervalSec * 1000) continue;
+ const effective = effectiveIntervalSec(policy.intervalSec, agent.heartbeatIdleStreak, policy.idleBackoff);
+ if (elapsedMs < effective * 1000) continue;
```

Everything else in `tickTimers` and all event-wake paths are untouched. With `enabled: false` the
effective interval equals `policy.intervalSec`, reproducing current behavior exactly.

## Observability & operator surface

- Expose `heartbeatIdleStreak` and the computed `effectiveHeartbeatIntervalSec` on the agent read
  path.
- UI readout on the agent row / admission surface: `idle ×N → backed off to <effective>` when
  `streak > 0` and backoff is enabled; plain configured interval otherwise. Reuses the existing
  status-line rendering pattern.
- Config controls (enable, multiplier, max interval) on the agent settings surface, alongside the
  existing heartbeat interval control.

## Testing

- **Pure** (`heartbeat-cadence.test.ts`): base passthrough, exponential growth per streak step, cap
  clamp, `enabled: false` passthrough, `multiplier <= 1` rejected by validator.
- **State**: empty timer heartbeat increments streak; productive heartbeat resets to 0; event wake
  resets to 0.
- **Integration** (`tickTimers`): an idle agent is polled progressively less often as its streak
  grows; an event wake fires immediately regardless of streak; the `maxIntervalSec` cap is honored;
  `enabled: false` reproduces today's cadence tick-for-tick.

## Files touched (anticipated)

- `packages/db/src/migrations/0113_heartbeat_idle_streak.sql`, `packages/db/src/schema/agents.ts`
- `packages/shared`: `idleBackoff` config type + validator; agent read-type additions
- `server/src/services/heartbeat-cadence.ts` (new pure module) + `heartbeat-cadence.test.ts`
- `server/src/services/heartbeat.ts`: `parseHeartbeatPolicy` (parse `idleBackoff`),
  `finalizeAgentStatus` (streak update), `enqueueWakeup` (event reset), `tickTimers` (effective gate)
- Agent read path (expose `heartbeatIdleStreak` + `effectiveHeartbeatIntervalSec`)
- `ui`: cadence readout + config controls
