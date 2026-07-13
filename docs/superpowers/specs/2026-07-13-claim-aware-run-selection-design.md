# Design: Claim-Aware Run Selection (Combo 01, Phase 4B slice 3)

Third and final slice of [`042-workspace-conflict-coordination.md`](../../../.ideas/042-workspace-conflict-coordination.md),
completing Track 4B of [Combo 01](../../../.ideas/combinations/combo-01-phasing-corrected.md). Slice 1
made concurrent shared-workspace occupancy *visible* (audit-only); slice 2 added the durable per-run,
per-subtree **claim** substrate (acquire / release / TTL-expire, advisory). This slice feeds those
claims into the **run-selection hook** so the scheduler can *act* on them: don't wake an agent to
start new work in a shared workspace another active run is already editing.

Per the phasing plan: *"the selection hook factors lock contention (don't wake an agent whose only
work is locked)."*

## Problem

Slice 2's claims are purely advisory — an overlapping claim is audited and returned, but nothing stops
a second agent from being *started* into a workspace someone else is actively editing. The soft-lock
has no consumer. This slice adds the one consumer that turns a claim into avoidance: the run-selection
loop, which decides which queued run an agent starts next.

## Substrate reality (from exploration)

The naive reading — "gate selection on the path a run will touch" — is impossible, and the design is
shaped by why:

- **A queued run's subtree is unknown at selection time.** A run declares its claim path *mid-run*
  via the slice-2 `POST` route, after the agent decides what to edit. At selection time we know only
  the run's issue → `issues.executionWorkspaceId` (may be null for isolated/uncreated workspaces) and
  the issue status. There is **no path/scope hint on the issue or run** (confirmed: no such column).
  Therefore selection can reason only at **workspace grain**, never subtree grain.
- **The seam already exists.** WIP enforcement (slice 4A-ii) added the exact pattern this slice
  reuses: in `startNextQueuedRunForAgent` → `claimUpTo` (`heartbeat.ts`), a queued run can be *left
  queued* (`continue`) with an audited deferral instead of being claimed. This slice adds a second,
  composable reason to defer.
- **Claim queries exist.** Slice 2 ships `listActiveClaimsOnWorkspace(executionWorkspaceId,
  excludeRunId)`; this slice adds one batched count variant so the sweep issues a single query, not
  one per queued run.
- **The queued timestamp exists.** `heartbeatRuns.createdAt` is the queued-at time (queued runs are
  ordered by it); `now - createdAt` is the bounded-defer clock — no new column.

Reused as-is: the `claimUpTo` defer/audit pattern, the `logActivity` audit channel, the wip-flow
"pure helper + fault-tolerant fallback" structure, and the slice-2 claim service.

## Scope

**In**
- A pure decision helper `decideClaimScheduling(...)` → `admit | defer | admit_despite_claim`.
- A batched `activeClaimCountsForWorkspaces(workspaceIds, now)` query on the claim service.
- Wiring in `startNextQueuedRunForAgent` / `claimUpTo`, composing with the existing WIP gate.
- An **instance-level** enable switch `workspaceClaimAwareScheduling` (boolean, default **off**).
- Two audit actions; fault isolation that admits-without-gate on any error.

**Out (explicit non-goals)**
- **Per-company override** of the switch — documented follow-up (needs a migration + settings UI).
  This slice ships the instance-level switch only.
- **Subtree-precise gating** — impossible without an issue-declared target path (a separate feature).
- **Any change to how claims are acquired/released/expired** (slice 2 owns that).
- Enforcement of claims *inside* a run (claims remain advisory to the running agent).

## Behavior

Gate applies only to **new-start** runs (issue in a not-yet-in-progress status, via the existing
`isNewStartIssueStatus` from wip-flow). Continuations always proceed — they are finishing work, not
piling new agents into a contended tree.

Precedence within the selection loop: a queued run is claimed only if **neither** the WIP gate nor the
claim gate defers it. The claim gate's bounded-admit (`admit_despite_claim`) overrides the *claim*
gate but **not** the WIP gate — a WIP-maxed agent still defers.

## Components

### 1. Pure decision — `server/src/services/workspace-claim-scheduling.ts` (new)

```ts
export type ClaimSchedulingDecision = "admit" | "defer" | "admit_despite_claim";

export function decideClaimScheduling(input: {
  enabled: boolean;
  isNewStart: boolean;
  activeClaimCount: number;
  queuedForMs: number;
  boundMs: number;
}): ClaimSchedulingDecision;
```

Logic:
- `!enabled` → `admit`
- `!isNewStart` → `admit`
- `activeClaimCount <= 0` → `admit`
- else `queuedForMs > boundMs` → `admit_despite_claim`
- else → `defer`

No DB, no clock — the caller passes `queuedForMs`. Sibling to slice-1's
`detectConcurrentSharedActivity`.

### 2. Batched contention query — `workspacePathClaimService`

```ts
activeClaimCountsForWorkspaces(
  executionWorkspaceIds: string[],
  now: Date,
): Promise<Map<string, number>>
```

Counts claims with `status = "active" AND expiresAt > now`, grouped by `executionWorkspaceId`, for the
given ids. The `expiresAt > now` filter excludes past-TTL-but-unswept rows so a stale claim the
reconciler hasn't flipped yet does not falsely block a new start. Empty input → empty map (no query).

### 3. Config resolution — instance setting

`workspaceClaimAwareScheduling: boolean` on the instance settings surface (`instance-settings.ts`),
default `false`. Resolved once per sweep in `startNextQueuedRunForAgent` into `{ enabled, boundMs }`
where `boundMs = DEFAULT_CLAIM_TTL_MS` (~30m, imported from `workspace-path-claims.ts`). When
`enabled` is false the gate is skipped entirely (no query, no per-run work) — byte-identical
scheduling to today.

### 4. Wiring — `startNextQueuedRunForAgent` / `claimUpTo` (`heartbeat.ts`)

- Add `executionWorkspaceId` to the queued-issue select (currently `id, status, priority`).
- After resolving config, if `enabled`: collect the distinct `executionWorkspaceId`s of queued
  **new-start** runs and call `activeClaimCountsForWorkspaces(ids, now)` once → `claimCounts` map.
  Wrapped in try/catch: on failure `logger.warn` and treat the gate as disabled for this sweep.
- In the `claimUpTo` loop, for each queued run resolve `issueId → issue.executionWorkspaceId`,
  compute `isNewStart` (already available), `activeClaimCount = claimCounts.get(wsId) ?? 0`,
  `queuedForMs = now - run.createdAt`, then `decideClaimScheduling(...)`:
  - `defer` → `auditClaimDeferral(...)` with action `issue.start_deferred_path_claim`; `continue`
    (leave queued; this run does not consume the WIP new-start budget).
  - `admit_despite_claim` → `auditClaimAdmitDespite(...)` with action
    `issue.start_admitted_despite_path_claim`; fall through to the existing claim path.
  - `admit` → existing claim path unchanged.
- The claim decision is evaluated **before** the existing WIP new-start check so a claim-deferred run
  is left queued without touching WIP counters; a run that clears the claim gate then passes through
  the unchanged WIP logic.

### 5. Audit

Actor `actorType: "system"`, `actorId: "workspace-conflict-scheduling"`, `entityType: "issue"`,
`entityId: issueId`, mirroring WIP's `issue.start_deferred_wip_limit`:

- `issue.start_deferred_path_claim` — `details: { executionWorkspaceId, contendingClaimCount, queuedForMs, boundMs }`
- `issue.start_admitted_despite_path_claim` — same `details` shape.

Audit writes are wrapped and swallowed on failure (as WIP's `auditWipDeferral` does) — an audit
failure never blocks admission.

## Data flow

```
sweep (startNextQueuedRunForAgent)
  resolve { enabled, boundMs } from instance settings
  if !enabled → unchanged scheduling
  distinct new-start executionWorkspaceIds
    └─ activeClaimCountsForWorkspaces(ids, now) ──▶ Map<wsId, count>   [1 query]
  claimUpTo loop, per queued run:
    decideClaimScheduling({ enabled, isNewStart, activeClaimCount, queuedForMs=now-createdAt, boundMs })
      admit               → (WIP gate) → claimQueuedRun
      defer               → audit start_deferred_path_claim,  continue (stay queued)
      admit_despite_claim → audit start_admitted_despite_path_claim → (WIP gate) → claimQueuedRun
```

## Error handling

- **Config/query failure:** `logger.warn`, gate disabled this sweep — every queued run admits through
  the unchanged path. Never throws into selection.
- **Audit failure:** swallowed; admission/deferral proceeds.
- **Null `executionWorkspaceId`** (isolated/uncreated workspace): `activeClaimCount = 0` → `admit`.
- **Stale (past-TTL, unswept) claim rows:** excluded by the `expiresAt > now` count filter, so they
  cannot wedge a workspace between reconciler sweeps.
- **Starvation:** bounded by `boundMs`; a new start queued longer than the bound is admitted with the
  `admit_despite_claim` audit, so a workspace with continuous rotating claims cannot defer a run
  forever, and the event is visible.

## Testing

- **Pure** (`workspace-claim-scheduling.test.ts`): all five branches of `decideClaimScheduling` —
  disabled→admit; continuation→admit; zero claims→admit; claims within bound→defer; claims past
  bound→admit_despite_claim; boundary `queuedForMs === boundMs`→defer.
- **Service** (embedded PG): `activeClaimCountsForWorkspaces` counts only active-within-TTL claims,
  groups by workspace, excludes released / expired-status / past-`expiresAt` / other-workspace rows;
  empty input → empty map without a query.
- **Heartbeat integration** (`heartbeat-claim-aware-selection-tick.test.ts`):
  - setting **on**, new-start run whose workspace has a sibling active claim from another run → stays
    queued, writes one `issue.start_deferred_path_claim`;
  - continuation into the same contended workspace → proceeds (claimed);
  - setting **off** → run proceeds, no claim query, no deferral audit;
  - run queued longer than `boundMs` with contention → claimed, writes
    `issue.start_admitted_despite_path_claim`;
  - claim-count query throws → run admitted (fault isolation), warn logged;
  - claim-deferred run does not consume the WIP new-start budget (composes with WIP gate).

## Exit criteria

- With `workspaceClaimAwareScheduling` on: a new-start run into a shared workspace another active run
  holds a live claim on is left queued and audited; a continuation into the same workspace proceeds; a
  new start deferred beyond `boundMs` is admitted with the distinct `admit_despite_claim` audit.
- With the setting off: scheduling is byte-identical to today (no query, no behavior change).
- No existing admission / WIP / run behavior changes when the gate admits; nothing throws into
  selection on any config, query, or audit failure.
- Track 4B — and with it the eight-member Combo 01 — is functionally complete.
