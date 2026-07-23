# Scope: Cadence-Transition Observability (idea 035 follow-up)

A lightweight, decision-gating observability step for **idea 035 (Adaptive Heartbeat Cadence)**. It does
**not** build the deferred speed-up-under-load slice; it produces the evidence needed to decide whether
that slice is worth building at all. It also lands one item already on 035's own deferred list
(*"Activity-log entries for cadence transitions"* — `2026-07-12-adaptive-heartbeat-cadence-design.md`,
Scope §Out).

## Why

035 shipped idle-backoff but deferred speed-up-under-load. The stated trigger for revisiting that
decision (per the re-audit discussion) is a **falsifiable condition**: *do agents ever back off while
real, assignable work is waiting and event-wakes aren't pulling it in?* Today nothing records that, so
the question can only be guessed. This step makes the condition **directly queryable** from
`activity_log` — a few hours of work that either justifies the speed-up slice or retires the idea of
building it.

## Goal

On each idle-backoff **cadence transition**, emit one `activity_log` entry carrying the interval change
**and a snapshot of the agent's actionable backlog**, so a single query answers: "how often did an agent
back off with `actionableBacklogCount > 0`?"

## Scope

**In**
- Emit an `activity_log` entry from `applyIdleStreakUpdate` (`heartbeat.ts:13250`) when the agent's
  **effective interval actually changes** (not on every heartbeat).
- A lightweight `startableIssueCountForAgent(companyId, agentId)` query (new, on `issueService`)
  counting issues assigned to the agent in a startable status.
- Log **both directions**: backoff (interval lengthened) and reset (snapped back to base).

**Out (YAGNI — do not build)**
- The speed-up-under-load slice itself.
- Any change to backoff *behavior* — this is pure observability.
- Any UI / dashboard. The raw `activity_log` entries + an ad-hoc query are the deliverable; a viewer is
  a separate call once the data proves interesting.
- Dependency-readiness precision in the backlog count (a status-only proxy is sufficient for a signal).
- Per-tier / instance-default toggles (also on 035's deferred list; not needed here).

## The one real decision (recommendation baked in)

**Attach the backlog snapshot vs. log the transition alone.** Logging only the interval change would tell
you *when* agents back off but not *whether work was waiting* — which is the entire question. So the
snapshot is worth the one extra COUNT query. **Recommendation: include it.** The cost is bounded because
the query fires only at transition moments (a handful per idle period, then silence once the interval
pins at `maxIntervalSec`), and only for backoff-enabled agents.

## Design

### Seam
`applyIdleStreakUpdate` already loads the agent, its config, and computes the new streak. Extend it:
after the streak write, compute `oldIntervalSec = effectiveIntervalSec(base, oldStreak, cfg)` and
`newIntervalSec = effectiveIntervalSec(base, newStreak, cfg)` (both from `heartbeat-cadence.ts`). If
`newIntervalSec === oldIntervalSec`, do nothing (covers the "streak grew but already at cap" case — no
spam). Otherwise emit the entry.

### Backlog count
New `issueService.startableIssueCountForAgent(companyId, agentId)`: `count(*)` of issues where
`assigneeAgentId = agentId AND status IN (WIP_NEW_START_STATUSES)` (reuse the existing
`todo | backlog | blocked` set from `wip-flow.ts` for consistency with the WIP gate). Documented as a
**proxy** — it does not check dependency readiness, so it may over-count blocked-on-deps work; that's an
acceptable upper bound for a "does the gap ever bite" signal.

### Audit entry
- `actorType: "system"`, `actorId: "heartbeat-cadence"`, `entityType: "agent"`, `entityId: agentId`
- `action: "agent.heartbeat_cadence_transition"`
- `details: { direction: "backoff" | "reset", oldStreak, newStreak, oldIntervalSec, newIntervalSec, wakeReason, outcome, actionableBacklogCount }`
- `direction`: `newIntervalSec > oldIntervalSec` → `"backoff"`, else `"reset"`.

### Fault isolation
The count query + `logActivity` are wrapped in one try/catch that logs a warn and swallows — a failure
here must never disturb the heartbeat finalize path (matches the codebase's `auditWipDeferral` /
`auditClaimScheduling` pattern). The streak write itself is unaffected.

## How the question gets answered

```sql
-- moments an agent backed off with work waiting = the gap biting
select count(*) from activity_log
where action = 'agent.heartbeat_cadence_transition'
  and details->>'direction' = 'backoff'
  and (details->>'actionableBacklogCount')::int > 0;
```
Empty (or negligible) over a few weeks of real traffic → the speed-up slice is not worth building; retire
it. Non-trivial → you now have concrete cases (and agents) to justify and target it.

## Testing

- **Pure:** transition detection — given `(base, oldStreak, newStreak, cfg)`, assert it fires only when
  `effectiveIntervalSec` changes and picks the right `direction` (0→1 backoff; N→0 reset; grow-at-cap no
  entry).
- **Service (embedded PG):** `startableIssueCountForAgent` counts only the agent's own issues in the
  startable set, excludes other agents / in-progress / done.
- **Integration:** a backoff transition writes exactly one entry with the snapshot; a reset writes one
  with `direction: "reset"`; a heartbeat that doesn't change the interval writes none; a thrown count
  query does not break the finalize path (fail-open).

## Size

~1–2 tasks: the `startableIssueCountForAgent` query + the transition-detection/emit in
`applyIdleStreakUpdate` (+ tests). No schema migration (activity_log is free-text details). No behavior
change, so no gating/parity risk.

## Exit criteria

With an idle backoff-enabled agent, backing off and later resuming produces two `activity_log` entries
whose `details` carry the interval change, direction, and a correct `actionableBacklogCount`; the query
above returns the number of "backed-off-with-backlog" moments; heartbeat behavior is otherwise unchanged.
