# Combo-03 Phase 1 — Run-signal read model (idea 031, redefined)

Status: design
Branch: `feat/combo03-phase1-run-signals` (off `master` @ `58eacd1`)
Source: `.ideas/combinations/combo-03-company-health-sentinel.md`, `.ideas/031-agent-run-distributed-tracing.md`

## Summary

One shared, queryable read model over the run/issue/cost data Paperclip already persists, so the
five Health Sentinel detectors read the same numbers instead of each re-stitching runs, comments,
and cost rows. No new tables, no migration, no new runtime dependency.

This replaces the combo's stated Phase 1 ("emit semantic OTel spans; that layer becomes the clean
data source every detector reads"). The reasoning is in [Why not spans](#why-not-spans).

## Why not spans

The combo doc assumes an OTel exporter that detectors can read back. `server/src/instrumentation.ts`
is not that:

- **It is opt-in and off by default.** It activates only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- **The packages are not in the dependency graph.** `@opentelemetry/*` are optional runtime
  dependencies, imported dynamically, deliberately kept off the default install to avoid a lockfile
  bump for an opt-in feature. A default install has no OTel code loaded at all.
- **Spans leave the process.** They are exported over OTLP to an external collector. Nothing reads
  them back.
- **It is auto-instrumentation only** — HTTP / Express / PG. There are no custom or semantic spans
  today.

So a detector built on spans would function only for the minority of self-hosters who wired up a
collector, and even then would require the server to query Jaeger/Tempo at analysis time. That is a
worse data source than what already exists.

What already exists in Postgres is richer than the span set idea 031 proposes:

| Table | Carries |
|---|---|
| `heartbeat_runs` | status, `startedAt`/`finishedAt`, `usageJson`, `resultJson`, retry lineage (`retryOfRunId`, `processLossRetryCount`, `scheduledRetryAttempt`), `exitCode`/`signal`/`errorCode`, liveness state, `lastUsefulActionAt`, `nextAction`, per-run ceilings, `contextSnapshot` |
| `heartbeat_run_events` | ordered per-step event stream (`seq`, `eventType`, `stream`, `level`, `payload`) |
| `cost_events` | per-run `provider`/`model`/`biller`, input/cached/output tokens, `costCents`, joined to `issueId`, `goalId`, `heartbeatRunId` |

Emitting semantic spans remains worthwhile as a *secondary export sink* for operators who run a
collector. It is explicitly deferred — it is an observability feature, not the detectors' backbone,
and conflating the two is what made Phase 1 look like a blocker.

## Motivation

`productivity-review.ts` (idea 003) is already built and already does this stitching privately. Its
`issueRunScopeSql` is the tell:

```ts
function issueRunScopeSql(issueId: string) {
  return sql`(
    ${heartbeatRuns.contextSnapshot}->>'issueId' = ${issueId}
    or ${heartbeatRuns.contextSnapshot}->>'taskId' = ${issueId}
    or ${heartbeatRuns.contextSnapshot}->>'taskKey' = ${issueId}
  )`;
}
```

Three JSON key variants, because run→issue attribution was never normalised. That predicate is
correctness-critical and currently lives in one detector's private scope. The next four detectors
(010, 026, 044, 059) and the heatmap (006) all need the same join. Copying it five times means five
places to get the key list wrong, and a heatmap whose numbers silently disagree with the detector
that fired.

Phase 1 makes that predicate — and the aggregations built on it — a single owned unit.

## Architecture

A read-only service under `server/src/services/run-signals/`. No writes, no side effects, no
scheduling. Detectors own their thresholds and escalation; this layer only answers "what happened."

```
run-signals/
  scope.ts          — owns the run↔issue join predicate + run status sets. One definition.
  issue-signals.ts  — getIssueRunSignals(db, companyId, scopes[], now) → Map<issueId, IssueRunSignals>
  index.ts          — runSignalsService(db) facade
```

Types live in `packages/shared/src/types/run-signals.ts` with the dual barrel export the repo uses.

**Batching is the load-bearing design constraint.** Every function takes an array of ids and returns
a `Map`. The heatmap (006) needs a whole company at once; an N+1 shape would make Phase 2 unusable
and would be a breaking change to fix later. Each aggregate is one grouped query over the id set,
not one query per id.

### `IssueRunSignals`

Per-issue progress fingerprint — what 003 consumes today and what 010/026/059 need.

Scope is a **`{ issueId, agentId }` pair**, not an issue alone. This is not a simplification that can
be dropped: `productivity-review.ts` counts runs and comments *for this issue by its assignee*, and
widening that to all agents would change which issues trip the detector. The batch API therefore
takes an array of pairs.

| Field | Source | Semantics to preserve exactly |
|---|---|---|
| `latestRuns` | `heartbeat_runs` matching the scope predicate, `createdAt desc`, **capped at 100** | The cap (`MAX_RUNS_FOR_STREAK`) bounds the streak walk; it is not an incidental limit |
| `terminalRunCount`, `activeRunCount` | counted over `latestRuns` by status set | terminal = `succeeded\|failed\|cancelled\|timed_out`; active = `queued\|running\|scheduled_retry` |
| `runCountLastHour`, `runCountLastSixHours` | windowed counts, agent-scoped | window uses `coalesce(startedAt, createdAt)`, **not** `startedAt` alone |
| `commentCount`, `commentCountLastHour`, `commentCountLastSixHours` | `issue_comments` **inner-joined to `heartbeat_runs`** on `createdByRunId` | counts only comments authored by the scoped agent *from a run attributed to this issue* — not all issue comments |
| `noCommentStreak` | walk `latestRuns` filtered to terminal, newest-first, stop at the first run that produced a comment | order matters; a naive `count` is wrong |
| `costCents` | `cost_events` by `issueId` | **not** agent-scoped — cost is per issue |

`elapsedMs` is deliberately **not** in this model. It derives from `issues.startedAt` /
`issues.executionLockedAt`, not from runs, so it stays in `productivity-review.ts`. Pulling
issue-lifecycle fields into a *run*-signal model would blur the boundary the phase exists to draw.

### `AgentRunSignals` — deferred to Phase 2

An earlier draft of this spec put per-agent reliability aggregates (success/failure counts, retry
rates, duration percentiles) in Phase 1 as "substrate for 044".

**Dropped, deliberately.** Nothing consumes it until 044 is built in Phase 2, so its interface would
be a guess — and an unconsumed API is exactly the failure mode this spec rejects in
[Why not spans](#why-not-spans). The argument against building the detectors on a data source no
detector can read applies equally to building a read model no detector has asked for.

`getIssueRunSignals` earns its place in Phase 1 because porting `productivity-review.ts` onto it
proves the interface against a real consumer. Agent signals get the same treatment when 044 exists
to define them — including what "success" means, which is a policy question this layer should not
answer unilaterally.

## The productivity-review refactor

`productivity-review.ts` switches to consume `getIssueRunSignals` in place of its private queries.
`issueRunScopeSql` moves to `run-signals/scope.ts`.

This is deliberate and is the point of the phase, not incidental cleanup:

- It **proves the read model is sufficient.** A backbone that no detector uses is a guess. Porting
  the one real detector is the only honest test of the interface.
- It **is protected by tests.** `server/src/__tests__/productivity-review-service.test.ts` has 11
  tests. They must stay green unmodified — that is the behaviour-preservation proof.

Thresholds, trigger selection, evidence formatting, escalation, snoozing and rate-limiting all stay
in `productivity-review.ts`. Only the data-gathering moves.

## Data flow

```
detector → runSignalsService(db).issueSignals([ids]) → scope predicate → grouped queries → Map
```

Read-only throughout. Safe to call repeatedly and concurrently. No caching in Phase 1 — the query
volume is bounded by company size and adding a cache before there is a measured problem would add
invalidation risk for no demonstrated gain.

## Error handling

- Unknown / cross-company ids are **omitted from the returned Map** rather than throwing. Callers
  handle absence, which is the natural shape for a batch read and avoids one bad id failing a whole
  heatmap.
- Every query is company-scoped. `companyId` is a required leading argument on all public functions,
  matching the tenancy discipline in the surrounding services.
- Runs whose `startedAt` or `finishedAt` is null are excluded from duration aggregates but still
  counted in run counts — a queued or crashed-before-start run is real, its duration is not.

## Testing

- **Aggregation tests** against embedded-postgres, per repo convention. These are SQL-heavy; testing
  them against hand-built objects would test nothing. Cover: the three-key scope predicate (one case
  per key variant), window boundaries, batch/`Map` shape, cross-company isolation, null-timestamp
  handling, empty-input short-circuit.
- **The existing 11 productivity-review tests stay green with no edits.** If a test needs changing,
  the refactor changed behaviour and is wrong.

## Out of scope for Phase 1

Deferred to Phase 2 (deterministic detectors + heatmap): global blocker-graph SCC/deadlock detection
(010), goal-drift orphan walk (026), decomposition quality checks (059), reliability SLO thresholds
and error budgets (044), the org-chart heatmap overlay (006), and any API route or UI. Phase 1 ships
no user-visible surface by design — the surface is Phase 2's deliverable, and shipping a route now
would mean designing a response shape before the consumers exist.

Deferred indefinitely: semantic OTel span emission as a secondary sink.
