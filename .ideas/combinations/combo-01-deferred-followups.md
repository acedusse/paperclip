# Combo 01 — Deferred Follow-Ups

Tracked backlog of work **intentionally descoped** while building Combo 01 (the Unified Runtime
Control Plane). The four-phase control plane is functionally complete (7 of 8 members DONE per the
[2026-07-13 re-audit](../COMPLETION-STATUS.md); see the
[phasing plan](combo-01-phasing-corrected.md)). The items below are the deliberate deferrals — each
shipped its high-value core and left a bounded remainder. None is a bug or a regression; each has a
concrete "build it when…" trigger so it isn't lost.

Status legend: 🔵 ready to build (prereqs met) · ⚪ build on demand (no prereq blocker, awaiting need).

---

## 1. 035-B — Adaptive Heartbeat: speed-up-under-load  ·  Phase 4A  ·  🔵

**What's missing:** the second direction of adaptive cadence — *shorten* an agent's heartbeat interval
when it has deep/urgent backlog. Idle-backoff (the slow-down direction) shipped and is DONE; this is
why idea 035 is scored 🟡 PARTIAL.

**Why deferred:** idle-backoff was the higher-ROI, lower-risk half. Speed-up needs (a) the admission
cap (001) + per-run caps (024) as guardrails so faster ticks can't amplify spend — *now built*, and
(b) a queue-depth × priority load signal that's harder to tune and prone to oscillation. The urgent
case is already covered by event-driven wakeup (a backed-off agent is pulled in instantly), so
speed-up only helps a deep backlog that isn't firing wake events.

**Build-it-when (falsifiable trigger):** the observability signal shipped in **PR #21** shows this
actually happens. Query:
```sql
select count(*) from activity_log
where action = 'agent.heartbeat_cadence_transition'
  and details->>'direction' = 'backoff'
  and (details->>'actionableBacklogCount')::int > 0;
```
Empty/negligible over a few weeks of real traffic → **retire this item**. Non-trivial → build it,
targeting the specific agents the query surfaces.

**Pointers:** `server/src/services/heartbeat-cadence.ts`, `applyIdleStreakUpdate` in `heartbeat.ts`;
design `docs/superpowers/specs/2026-07-12-adaptive-heartbeat-cadence-design.md` (§Scope "Out");
observability scope `docs/superpowers/specs/2026-07-13-cadence-transition-observability-scope.md`;
idea `.ideas/035-adaptive-heartbeat-cadence.md`; PR #21.

---

## 2. 005-B — Spend-Schedule: burn-per-hour ceiling  ·  Phase 3  ·  ⚪

**What's missing:** the `maxBurnPerHour` (spend-rate) dimension of scheduled/quiet-hours caps. Only the
`maxConcurrentRuns` (concurrency) dimension shipped — which delivered the quiet-hours value — so 005 is
scored ✅ DONE with this noted gap.

**Why deferred:** concurrency scheduling is the primary operator lever and was self-contained; a
time-windowed spend-rate ceiling is a second knob that also overlaps the predictive breaker (002),
which already caps burn reactively.

**Build-it-when:** operators need *scheduled* spend-rate throttling distinct from both the reactive
breaker and concurrency windows (e.g. a hard "no more than $X/hour during nights" policy). Would extend
the existing `schedule` cap writer to carry a per-window burn ceiling.

**Pointers:** `server/src/services/schedule-cap.ts`, `scheduleWriter` in `effective-cap-resolver.ts`,
`companies.scheduleWindows`; idea `.ideas/005-spend-schedule-quiet-hours.md`.

---

## 3. 024-B — Per-Run Caps: tool-call / token caps  ·  Phase 2  ·  ⚪

**What's missing:** `maxToolCalls` and per-run token caps. Wall-clock (`maxRunWallClockMs`) and cost
(`maxRunCostCents`) caps shipped with graceful wind-down + crash-safe sweep, and turns are
adapter-CLI-delegated (`--max-turns` for `claude_local`/`grok_local`); 024 is scored ✅ DONE on that
core. A tool-call counter and token cap were not built.

**Why deferred:** the idea itself flagged tool-call/step coverage as **uneven across adapters** and
lower-priority, with wall-clock + cost as ship-first. A per-run tool-call counter depends on every
adapter surfacing step/tool-call events uniformly, which they don't.

**Build-it-when:** adapters expose consistent per-step/tool-call events, or a runaway-tool-call failure
mode shows up that wall-clock + cost don't already bound. Sub-phase per adapter (don't block on full
coverage).

**Pointers:** `server/src/services/run-caps.ts`, cap columns on `heartbeat_runs`; idea
`.ideas/024-per-run-resource-caps.md`.

---

## See also — minor fast-follows (documented in PRs, not phase-level deferrals)

- **024:** cap trips log a system run-event but have no dedicated operator/inbox escalation or a
  "run stopped due to cap" UI surface.
- **014:** the breaker's auto-halt zeroes the cap directly rather than flipping `runExecutionState` to
  `draining` (parallel form of the auto-trigger).
- **002:** `halt` winds down *all* running runs (no protected-role/critical-path allowlist).
- **035-observability (PR #21):** the audit reads the base interval via `parseHeartbeatCadenceConfig`
  (strict number) while the scheduler uses `parseHeartbeatPolicy` (coerces string configs) — diverge
  only if `intervalSec` is stored as a non-number string; failure mode is "signal silently absent,"
  never wrong data. Consider unifying on the policy parser.
