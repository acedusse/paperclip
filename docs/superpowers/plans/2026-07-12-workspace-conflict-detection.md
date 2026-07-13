# Concurrent Shared-Workspace Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit a read-only `activity_log` entry when a run executes in a shared execution workspace another run is already active in — the collision risk condition — without locking, blocking, or changing execution.

**Architecture:** A pure decision helper (`workspace-conflict.ts`), one service query on `workspace_operations ⨝ heartbeat_runs`, and a best-effort hook in `executeRun`. Reuses `activity_log` and existing tables. No schema, no migration.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Vitest + embedded Postgres, `logActivity`.

## Global Constraints

- **Base branch:** `feat/combo-01-workspace-conflict` (off `master`, which has the merged WIP slices). Independent of the WIP work.
- **Detect the risk condition, not a confirmed clobber:** the audit action is `workspace_concurrent_activity_detected` (concurrent occupancy), never "collision"/"clobber".
- **Only `mode === "shared_workspace"` is ever flagged.** Isolated/per-issue worktrees are a no-op — the detection query must not even run for them.
- **Best-effort, read-only:** the entire hook is wrapped so any query/audit failure is logged and swallowed — a detection error must NEVER abort or alter a run. No gating, no new lock.
- **Once per joining run:** the hook fires at most once per run execution (not per heartbeat sweep).
- **Run→workspace link is `workspace_operations`** (`heartbeatRunId` + `executionWorkspaceId`); runs carry no workspace column. "Other running runs on W" = distinct `heartbeatRunId` from `workspace_operations ⨝ heartbeat_runs` where `status='running'` and `executionWorkspaceId=W`, excluding this run.
- **Correct focused test command** (the `pnpm --filter … test` form silently no-ops): `cd server && npx vitest run <pattern>`; typecheck `cd server && npx tsc --noEmit`.

---

### Task 1: Pure concurrent-activity decision helper

**Files:**
- Create: `server/src/services/workspace-conflict.ts`
- Test: `server/src/services/workspace-conflict.test.ts`

**Interfaces:**
- Produces:
  - `ConcurrentSharedActivity = { isConcurrent: boolean; otherRunIds: string[] }`
  - `detectConcurrentSharedActivity(input: { workspaceMode: string | null | undefined; otherActiveRunIds: string[] }): ConcurrentSharedActivity`

- [ ] **Step 1: Write the failing test**

Create `server/src/services/workspace-conflict.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectConcurrentSharedActivity } from "./workspace-conflict.js";

describe("detectConcurrentSharedActivity", () => {
  it("flags a shared workspace with other active runs (deduped)", () => {
    expect(detectConcurrentSharedActivity({
      workspaceMode: "shared_workspace",
      otherActiveRunIds: ["r1", "r2", "r1"],
    })).toEqual({ isConcurrent: true, otherRunIds: ["r1", "r2"] });
  });
  it("does not flag a shared workspace with no other runs", () => {
    expect(detectConcurrentSharedActivity({
      workspaceMode: "shared_workspace",
      otherActiveRunIds: [],
    })).toEqual({ isConcurrent: false, otherRunIds: [] });
  });
  it("never flags an isolated workspace, even with other runs", () => {
    expect(detectConcurrentSharedActivity({
      workspaceMode: "isolated_workspace",
      otherActiveRunIds: ["r1"],
    })).toEqual({ isConcurrent: false, otherRunIds: [] });
  });
  it("never flags a null/undefined mode", () => {
    expect(detectConcurrentSharedActivity({ workspaceMode: null, otherActiveRunIds: ["r1"] }))
      .toEqual({ isConcurrent: false, otherRunIds: [] });
    expect(detectConcurrentSharedActivity({ workspaceMode: undefined, otherActiveRunIds: ["r1"] }))
      .toEqual({ isConcurrent: false, otherRunIds: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run workspace-conflict`
Expected: FAIL — cannot find `./workspace-conflict.js`.

- [ ] **Step 3: Create the module**

Create `server/src/services/workspace-conflict.ts`:

```ts
export interface ConcurrentSharedActivity {
  isConcurrent: boolean;
  otherRunIds: string[];
}

/**
 * A run "collides" (risk sense) when it executes in a shared workspace that
 * other runs are already active in. Isolated/per-issue workspaces are never
 * flagged — separate trees cannot clobber each other. This detects concurrent
 * occupancy (the risk condition), not a confirmed byte-level file clobber.
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run workspace-conflict`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/workspace-conflict.ts server/src/services/workspace-conflict.test.ts
git commit -m "feat(workspace): pure concurrent shared-activity detector"
```

---

### Task 2: `runningRunIdsOnWorkspace` service query

**Files:**
- Modify: `server/src/services/workspace-operations.ts` (add `ne`, `isNotNull` to the `drizzle-orm` import at line 19; add `heartbeatRuns` to the `@paperclipai/db` import at line 17; add a method to the object returned by `workspaceOperationService(db)`, whose existing methods are `getById`, `createRecorder`, `attachExecutionWorkspaceId`, `recordOperation`, `listForRun`, `listForExecutionWorkspace`, `readLog`)
- Test: `server/src/__tests__/workspace-operations-concurrency.test.ts` (new; embedded Postgres, mirroring the harness of `server/src/__tests__/execution-workspaces-service.test.ts`)

**Interfaces:**
- Produces (method on `workspaceOperationService(db)`):
  `runningRunIdsOnWorkspace(executionWorkspaceId: string, excludeRunId: string): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/workspace-operations-concurrency.test.ts` (model imports/harness on `execution-workspaces-service.test.ts` — `getEmbeddedPostgresTestSupport`, `startEmbeddedPostgresTestDatabase`, `createDb`, and the schema tables from `@paperclipai/db`):

```ts
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { createDb, companies, agents, executionWorkspaces, heartbeatRuns, workspaceOperations } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { workspaceOperationService } from "../services/workspace-operations.ts";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

describeEmbeddedPostgres("workspaceOperationService.runningRunIdsOnWorkspace", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof workspaceOperationService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-wsop-concurrency-");
    db = createDb(tempDb.connectionString);
    svc = workspaceOperationService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(workspaceOperations);
    await db.delete(heartbeatRuns);
    await db.delete(executionWorkspaces);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => { await tempDb?.cleanup(); });

  async function seed() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const wsA = randomUUID();
    const wsB = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "P", issuePrefix: "WSC1", requireBoardApprovalForNewAgents: false });
    await db.insert(agents).values({ id: agentId, companyId, name: "A", urlKey: "a", adapterType: "process" });
    await db.insert(executionWorkspaces).values([
      { id: wsA, companyId, mode: "shared_workspace", strategyType: "shared", status: "active", cwd: "/tmp/a" },
      { id: wsB, companyId, mode: "shared_workspace", strategyType: "shared", status: "active", cwd: "/tmp/b" },
    ]);
    return { companyId, agentId, wsA, wsB };
  }

  async function seedRun(companyId: string, agentId: string, status: string) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status });
    return runId;
  }

  async function seedOp(companyId: string, runId: string, workspaceId: string) {
    await db.insert(workspaceOperations).values({
      id: randomUUID(), companyId, heartbeatRunId: runId, executionWorkspaceId: workspaceId,
      phase: "workspace_provision", status: "running", startedAt: new Date(),
    });
  }

  it("returns other running runs with an op-log row on the same workspace, excluding self", async () => {
    const { companyId, agentId, wsA } = await seed();
    const runSelf = await seedRun(companyId, agentId, "running");
    const runPeer = await seedRun(companyId, agentId, "running");
    await seedOp(companyId, runSelf, wsA);
    await seedOp(companyId, runPeer, wsA);
    expect(await svc.runningRunIdsOnWorkspace(wsA, runSelf)).toEqual([runPeer]);
  });

  it("excludes runs whose op-log row is on a different workspace", async () => {
    const { companyId, agentId, wsA, wsB } = await seed();
    const runSelf = await seedRun(companyId, agentId, "running");
    const runOther = await seedRun(companyId, agentId, "running");
    await seedOp(companyId, runSelf, wsA);
    await seedOp(companyId, runOther, wsB);
    expect(await svc.runningRunIdsOnWorkspace(wsA, runSelf)).toEqual([]);
  });

  it("excludes runs that are not running", async () => {
    const { companyId, agentId, wsA } = await seed();
    const runSelf = await seedRun(companyId, agentId, "running");
    const runDone = await seedRun(companyId, agentId, "succeeded");
    await seedOp(companyId, runSelf, wsA);
    await seedOp(companyId, runDone, wsA);
    expect(await svc.runningRunIdsOnWorkspace(wsA, runSelf)).toEqual([]);
  });
});
```

(If a column name in a seed insert doesn't match the schema, correct the seed to the real column — do NOT change the assertions. Check `packages/db/src/schema/{execution_workspaces,heartbeat_runs,workspace_operations}.ts` for required NOT-NULL columns and add them to the seeds as needed.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run workspace-operations-concurrency`
Expected: FAIL — `svc.runningRunIdsOnWorkspace is not a function`. (If embedded Postgres is unsupported here, the suite SKIPS — note it and rely on Task 4's typecheck + the Task 3 integration path.)

- [ ] **Step 3: Add imports**

In `server/src/services/workspace-operations.ts`:
- Line 17: `import { workspaceOperations, heartbeatRuns } from "@paperclipai/db";`
- Line 19: `import { asc, desc, eq, inArray, isNull, isNotNull, ne, or, and } from "drizzle-orm";`

- [ ] **Step 4: Add the method**

Inside the object returned by `workspaceOperationService(db)`, add:

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

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run workspace-operations-concurrency`
Expected: PASS (3/3, or SKIP if embedded Postgres unsupported).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/workspace-operations.ts server/src/__tests__/workspace-operations-concurrency.test.ts
git commit -m "feat(workspace): query running runs sharing an execution workspace"
```

---

### Task 3: `executeRun` detection hook + audit

**Files:**
- Modify: `server/src/services/heartbeat.ts` (import `detectConcurrentSharedActivity` from `./workspace-conflict.js`; add a module-internal `auditConcurrentSharedActivity` helper near the other admission/audit helpers; call it in `executeRun` right after the recorder is wired at heartbeat.ts:9410-9414)
- Test: `server/src/__tests__/heartbeat-workspace-conflict.test.ts` (new; embedded Postgres)

**Interfaces:**
- Consumes: `detectConcurrentSharedActivity` (Task 1); `workspaceOperationsSvc.runningRunIdsOnWorkspace` (Task 2); `logActivity` (already imported at heartbeat.ts:112); `existingExecutionWorkspace` (`.id`, `.mode`) in scope at heartbeat.ts:9414.
- Produces: `activity_log` action `workspace_concurrent_activity_detected` on `entityType: "execution_workspace"`.

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/heartbeat-workspace-conflict.test.ts`. Prefer driving the real path via `heartbeat.startNextQueuedRunForAgent`/`executeRun` if the harness (see `heartbeat-instance-admission.test.ts` for how it drives runs) makes it tractable to seed a shared workspace + a concurrent running run + a queued run for this workspace. If isolating the full executor proves impractical, instead export `auditConcurrentSharedActivity` for testing and assert against seeded state directly. Either way, assert the OUTCOME:

```ts
// Given: a shared_workspace W, an already-running peer run with a workspace_operations row on W,
// and this run executing in W ⇒ exactly one activity_log row:
//   action = "workspace_concurrent_activity_detected", entityType = "execution_workspace",
//   entityId = W, details.concurrentRunIds contains the peer run id.
// And: an isolated workspace, or no peer run ⇒ zero such rows.
```

Concretely assert on `activity_log`:

```ts
const audits = await db.select().from(activityLog)
  .where(and(eq(activityLog.action, "workspace_concurrent_activity_detected"), eq(activityLog.entityId, wsA)));
expect(audits).toHaveLength(1);
expect((audits[0].details as { concurrentRunIds: string[] }).concurrentRunIds).toContain(peerRunId);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run heartbeat-workspace-conflict`
Expected: FAIL — no such activity row (hook not wired). Confirm a real assertion failure, not an empty exit-0 or harness error (fix the harness until you get a genuine RED).

- [ ] **Step 3: Add the import**

At the top of `server/src/services/heartbeat.ts`:

```ts
import { detectConcurrentSharedActivity } from "./workspace-conflict.js";
```

- [ ] **Step 4: Add the audit helper**

Near the other module-internal audit helpers in `heartbeat.ts` (with `db`, `logActivity`, `logger`, `workspaceOperationsSvc` in scope):

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

(Confirm the exact symbol for the workspace-operations service instance in this file — the recorder is created via `workspaceOperationsSvc.createRecorder(...)` near heartbeat.ts:9410; use that same instance name.)

- [ ] **Step 5: Wire the hook in `executeRun`**

Immediately after the `workspaceOperationRecorder = workspaceOperationsSvc.createRecorder({ … })` block (heartbeat.ts:9410-9414), add:

```ts
    if (existingExecutionWorkspace && existingExecutionWorkspace.mode === "shared_workspace") {
      await auditConcurrentSharedActivity(agent, run.id, existingExecutionWorkspace.id);
    }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd server && npx vitest run heartbeat-workspace-conflict`
Expected: PASS.

- [ ] **Step 7: Guard the hot path (no regression for the common non-shared case)**

Run: `cd server && npx vitest run heartbeat-instance-admission`
Expected: PASS — the hook is a no-op for non-shared workspaces, so admission/execution behavior is unchanged.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/heartbeat-workspace-conflict.test.ts
git commit -m "feat(workspace): detect + audit concurrent shared-workspace activity at run start"
```

---

### Task 4: Typecheck + suite gate

**Files:** none (verification task)

- [ ] **Step 1: Server typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 2: Touched-area suites**

Run: `cd server && npx vitest run "workspace-conflict" "workspace-operations-concurrency" "heartbeat-workspace-conflict"`
Expected: all PASS (embedded-Postgres suites may SKIP if unsupported — note it).

- [ ] **Step 3: Full workspace typecheck**

Run (repo root): `pnpm -r typecheck`
Expected: GREEN.

- [ ] **Step 4: Verify the branch**

```bash
git log --oneline master..HEAD
```
Expected: the spec commit + three feature commits, all tests green.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-12-workspace-conflict-detection-design.md`):
- Pure detector, shared-only, deduped (spec §Architecture 1, §decisions 1/2) → Task 1.
- `runningRunIdsOnWorkspace` via `workspace_operations ⨝ heartbeat_runs` status='running', exclude self (spec §Architecture 2, §decision 4) → Task 2.
- `executeRun` hook gated on `shared_workspace`, best-effort audit (spec §Architecture 3, §decisions 3/5) → Task 3.
- Read-only / never breaks execution (spec §decision 5, §Error handling) → Task 3 try/catch swallow + Step 7 regression.
- No schema/migration → no task adds a table.

**Placeholder scan:** Task 3 Step 1 gives the assertion shape and an explicit fallback (export the helper if driving the full executor is impractical) rather than a full harness literal, because the exact run-driving boilerplate must match `heartbeat-instance-admission.test.ts`; the asserted outcome (one audit row with `concurrentRunIds` containing the peer) is fully specified. Task 2's seeds carry a "correct the seed to the real NOT-NULL columns" instruction — that's schema-shape latitude, not an under-specified assertion.

**Type consistency:** `detectConcurrentSharedActivity` / `ConcurrentSharedActivity` names match across Task 1 (def) and Task 3 (use). `runningRunIdsOnWorkspace(workspaceId, excludeRunId): Promise<string[]>` is identical in Task 2 (def), Task 3 (call). The audit action string `workspace_concurrent_activity_detected` and `entityType: "execution_workspace"` are identical in Task 3 (helper) and the Task 2/3 test assertions.
