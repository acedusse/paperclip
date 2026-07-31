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
  scope.ts          — owns the run↔issue join predicate. One definition.
  issue-signals.ts  — getIssueRunSignals(db, companyId, issueIds[])  → Map<issueId, IssueRunSignals>
  agent-signals.ts  — getAgentRunSignals(db, companyId, agentIds[], window) → Map<agentId, AgentRunSignals>
  index.ts          — runSignalsService(db) facade
```

Types live in `packages/shared/src/types/run-signals.ts` with the dual barrel export the repo uses.

**Batching is the load-bearing design constraint.** Every function takes an array of ids and returns
a `Map`. The heatmap (006) needs a whole company at once; an N+1 shape would make Phase 2 unusable
and would be a breaking change to fix later. Each aggregate is one grouped query over the id set,
not one query per id.

### `IssueRunSignals`

Per-issue progress fingerprint — what 003 consumes today and what 010/026/059 need.

| Field | Source |
|---|---|
| `totalRunCount`, `terminalRunCount`, `activeRunCount` | `heartbeat_runs` grouped by status |
| `runCountLastHour`, `runCountLastSixHours` | windowed counts |
| `commentCount`, `commentCountLastHour`, `commentCountLastSixHours` | `issue_comments` |
| `noCommentStreak` | runs since the most recent comment |
| `firstRunAt`, `lastRunAt`, `elapsedMs` | min/max `startedAt` |
| `costCents`, `inputTokens`, `cachedInputTokens`, `outputTokens` | `cost_events` |
| `retryRunCount` | runs with non-null `retryOfRunId` |
| `lastUsefulActionAt`, `nextAction` | latest run |

### `AgentRunSignals`

Per-agent rolling reliability over a caller-supplied window — the substrate 044 needs, computed but
not yet thresholded. `window` is an explicit `{ since: Date; until?: Date }`; there is no default,
because a silent default window is exactly the kind of hidden assumption that makes two detectors
disagree about the same agent.

| Field | Source |
|---|---|
| `runCount`, `succeededCount`, `failedCount` | `heartbeat_runs` by terminal status |
| `errorCodeCounts` | grouped `errorCode` |
| `retriedRunCount`, `processLossRetryTotal` | retry lineage columns |
| `medianDurationMs`, `p90DurationMs` | `finishedAt - startedAt` over terminal runs |
| `costCents` | `cost_events` |

`succeededCount / runCount` is left to the caller — 044 defines what an error budget is; this layer
does not.

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
