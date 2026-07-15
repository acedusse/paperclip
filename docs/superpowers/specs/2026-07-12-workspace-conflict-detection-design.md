# Design: Concurrent Shared-Workspace Detection (Combo 01, Phase 4B slice 1)

First slice of [`042-workspace-conflict-coordination.md`](../../../.ideas/042-workspace-conflict-coordination.md),
Track 4B of [`combo-01-phasing-corrected.md`](../../../.ideas/combinations/combo-01-phasing-corrected.md).
Read-only detection of the collision **risk condition** — nothing is locked or blocked.

## Problem

Multiple agents can operate in a shared execution workspace (`mode: "shared_workspace"`) — one
working tree serving many issues/runs. When two runs are active in that tree at once they can clobber
each other's uncommitted edits (last-write-wins, lost work). Today nothing surfaces this: the
workspace model only reasons about conflict at *close* time (`blockingReasons`), and there is no
signal at all that "two agents are live in the same tree right now."

This slice makes that risk *visible*: when a run executes in a shared workspace another run is
already active in, it writes an audit entry. It does not lock, block, or change execution — it is the
observability layer the later locking/ownership slices build on.

## Substrate reality (why this is the honest first slice)

The phasing doc assumed "collision detection from the existing op log." That premise does not hold:
`workspace_operations` (`packages/db/src/schema/workspace_operations.ts`) is a **workspace-lifecycle**
log — one row per provision/teardown phase (`worktree_prepare`, `workspace_provision`,
`workspace_teardown`, …) — with **no file-path column, no read/write kind, no per-file diff**. So
"run A wrote the same file as run B" is *not* derivable from any persisted data. File-level changed
paths exist only git-derived on demand (`workspace-file-resources.ts` `listChangedWorkspaceFiles`),
and in a shared tree `git status` shows the *union* of all runs' edits, so paths can't be attributed
to a specific run without new capture infrastructure.

What **is** cleanly derivable, table-only and zero-risk, is **concurrent occupancy**: distinct
currently-running runs linked to the same shared workspace. That is the collision *risk condition*,
and it is exactly what this slice detects. Per-path attribution and byte-level clobber detection are
deferred to the capture/lock slices.

## Scope

**In**
- At run execution, if the run's execution workspace is `shared_workspace` **and** ≥1 *other* run is
  currently active in it, write one `activity_log` entry
  (`action: "workspace_concurrent_activity_detected"`).
- A pure decision helper, one service query, the `executeRun` hook, and tests.

**Out (later 042 slices)**
- Path-level soft locks / claims (the `environmentLeases` lease pattern).
- Git-derived per-path capture and byte-level clobber detection.
- Ownership zones (operator-assigned subtrees per team/agent).
- Factoring lock contention into admission/selection (idea 001).
- Collision resolution UX (inbox/review item, handoff).

**Not built (already exists — reused)**
- `workspace_operations` (run→workspace link via `heartbeatRunId` + `executionWorkspaceId`),
  `heartbeat_runs.status`, `execution_workspaces.mode` — the concurrency signal.
- `logActivity(db, input)` (`server/src/services/activity-log.ts`) — the audit sink.
- No new schema, **no migration**.

## Design decisions (locked)

1. **Detect the risk condition, not a confirmed clobber.** This slice flags concurrent *occupancy*
   of a shared tree. It never claims a byte-level file collision occurred — that requires the later
   capture/lock slices. The audit action name and details reflect "concurrent activity," not
   "collision."

2. **Only `shared_workspace` is ever flagged.** Per-issue worktrees (`isolated_workspace` and the
   default per-task modes) have separate trees, so concurrent runs there cannot clobber each other.
   The detection is a no-op for every non-shared workspace — which is the common case, so the hot
   path is untouched for almost all runs.

3. **Detect at run execution, once per joining run.** The hook fires in `executeRun` when a run
   begins working in a shared workspace. It emits at most one audit per run that *joins* an occupied
   shared workspace — bounded by run starts, not by heartbeat sweeps. (Contrast the WIP-enforcement
   per-sweep audit, which this deliberately avoids.)

4. **`workspace_operations` is the run→workspace link.** Runs carry no `executionWorkspaceId` column;
   the persistent link is a `workspace_operations` row (`heartbeatRunId` + `executionWorkspaceId`).
   "Other running runs on workspace W" = distinct `heartbeatRunId` from
   `workspace_operations ⨝ heartbeat_runs` where `heartbeat_runs.status = 'running'` and
   `executionWorkspaceId = W`, excluding this run. There is inherent timing looseness (a just-started
   peer may not have its op-log row yet); for a visibility signal that is acceptable and errs toward
   under-reporting, never false execution changes.

5. **Best-effort, read-only, never breaks execution.** The detection is additive audit only. The
   whole hook is wrapped so any failure (query or `logActivity`) is logged and swallowed — a
   detection error must never abort or alter a run.

6. **The decision is pure and unit-tested.** The shared-mode + others-present decision lives in a
   pure function; the DB query feeds it. The gate logic is verified without the heartbeat harness.

## Architecture

### 1. Pure decision helper — `server/src/services/workspace-conflict.ts` (new)

```ts
export interface ConcurrentSharedActivity {
  isConcurrent: boolean;
  otherRunIds: string[];
}

/**
 * A run "collides" (risk sense) when it executes in a shared workspace that
 * other runs are already active in. Isolated/per-issue workspaces are never
 * flagged — separate trees cannot clobber each other.
 */
export function detectConcurrentSharedActivity(input: {
  workspaceMode: string | null | undefined;
  otherActiveRunIds: string[];
}): ConcurrentSharedActivity {
  if (input.workspaceMode !== "shared_workspace") return { isConcurrent: false, otherRunIds: [] };
  const otherRunIds = [...new Set(input.otherActiveRunIds)];
  return { isConcurrent: otherRunIds.length > 0, otherRunIds };
}
```

### 2. Service query — `server/src/services/workspace-operations.ts` (extend the service)

Add a method to `workspaceOperationService(db)`:

```ts
runningRunIdsOnWorkspace: async (executionWorkspaceId: string, excludeRunId: string): Promise<string[]> => {
  const rows = await db
    .selectDistinct({ runId: workspaceOperations.heartbeatRunId })
    .from(workspaceOperations)
    .innerJoin(heartbeatRuns, eq(heartbeatRuns.id, workspaceOperations.heartbeatRunId))
    .where(and(
      eq(workspaceOperations.executionWorkspaceId, executionWorkspaceId),
      eq(heartbeatRuns.status, "running"),
      ne(workspaceOperations.heartbeatRunId, excludeRunId),
      isNotNull(workspaceOperations.heartbeatRunId),
    ));
  return rows.map((r) => r.runId).filter((id): id is string => id != null);
},
```

Uses the existing `(companyId, executionWorkspaceId, startedAt)` index for the workspace scan.

### 3. `executeRun` hook — `server/src/services/heartbeat.ts`

Immediately after the workspace-operation recorder is wired (heartbeat.ts:9410-9414), where
`existingExecutionWorkspace` (with `.id` and `.mode`) is in scope:

```ts
if (existingExecutionWorkspace && existingExecutionWorkspace.mode === "shared_workspace") {
  await auditConcurrentSharedActivity(agent, run.id, existingExecutionWorkspace.id);
}
```

with a module-internal best-effort helper:

```ts
async function auditConcurrentSharedActivity(
  agent: { id: string; companyId: string },
  runId: string,
  workspaceId: string,
) {
  try {
    const otherActiveRunIds = await workspaceOperationsSvc.runningRunIdsOnWorkspace(workspaceId, runId);
    const { isConcurrent, otherRunIds } = detectConcurrentSharedActivity({
      workspaceMode: "shared_workspace",
      otherActiveRunIds,
    });
    if (!isConcurrent) return;
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: "system",
      actorId: "workspace-conflict-detection",
      agentId: agent.id,
      runId,
      action: "workspace_concurrent_activity_detected",
      entityType: "execution_workspace",
      entityId: workspaceId,
      details: { concurrentRunIds: otherRunIds, count: otherRunIds.length },
    });
  } catch (err) {
    logger.warn({ err, workspaceId, runId }, "concurrent shared-workspace detection failed; ignoring");
  }
}
```

## Data flow

```
executeRun (run claimed → executing)
   │  recorder wired with executionWorkspaceId (heartbeat.ts:9414)
   │  existingExecutionWorkspace.mode === "shared_workspace"?  ── no ─▶ (no-op; common case)
   ▼ yes
runningRunIdsOnWorkspace(workspaceId, run.id)      [workspace_operations ⨝ heartbeat_runs status=running]
   ▼
detectConcurrentSharedActivity({ mode, otherActiveRunIds })  (pure)
   ▼ isConcurrent
logActivity("workspace_concurrent_activity_detected", entity=execution_workspace, details={concurrentRunIds,count})
```

## Error handling

- **Query / audit failure:** logged and swallowed inside the helper — never aborts or alters the run.
- **Non-shared workspace / no workspace:** the hook is skipped entirely (guarded on `.mode`), so the
  detection query never runs for the common per-issue-worktree case.
- **Lone run in a shared workspace:** `otherActiveRunIds` empty ⇒ `isConcurrent: false` ⇒ no audit.
- **Timing looseness:** a peer run that just started may lack an op-log row and be missed this sweep;
  under-reporting is acceptable for a visibility signal and never produces a false execution change.

## Testing

- **Pure** (`workspace-conflict.test.ts`): `detectConcurrentSharedActivity` — shared + others ⇒
  `isConcurrent: true` with deduped `otherRunIds`; shared + none ⇒ false; `isolated_workspace` /
  `null` mode ⇒ false regardless of others.
- **Service query** (embedded Postgres, mirroring `execution-workspaces-service.test.ts`): seed one
  shared `execution_workspaces` row + two `heartbeat_runs` (both `running`) + a `workspace_operations`
  row per run on that workspace ⇒ `runningRunIdsOnWorkspace(W, runA)` returns `[runB]`; a run whose
  op-log row is on a *different* workspace, or whose run is not `running`, is excluded.
- **Integration** (embedded Postgres): drive the `executeRun` path (or, if isolating the full run
  executor is impractical in the harness, call the exported detection helper against seeded state) so
  that a second run joining a shared workspace already occupied by a running run writes exactly one
  `workspace_concurrent_activity_detected` activity row naming the other run; an isolated workspace or
  a lone run writes none.

## Exit criteria

- A run beginning work in a `shared_workspace` already occupied by another running run produces one
  `workspace_concurrent_activity_detected` activity-log entry naming the concurrent run(s); a run in
  an isolated/per-issue workspace, or the only run in a shared workspace, produces none.
- Detection never changes which runs start or how they execute, and any detection error is swallowed.
- No schema change and no migration.
