# Admission Reconciler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Combo-01 Phase-1 reconciler as a pluggable source registry that reclaims leaked admission slots, wrapping the existing `reapOrphanedRuns` behind a named seam, and prove the crash-reclaim exit criterion with tests.

**Architecture:** A new `admission-reconciler.ts` provides `runReconcile(sources, now)` — a fault-isolating fold over a list of `ReconcileSource`s. Phase 1 ships one source, `run-liveness`, that delegates to `heartbeat.reapOrphanedRuns` (no rewrite). The existing periodic sweep in `index.ts` calls `runReconcile` instead of `reapOrphanedRuns` directly, so the reaper runs exactly once per tick via the reconciler. Because the admission gate counts `status='running'` live from the DB, reaping a dead row reclaims its slot on the next gate tick.

**Tech Stack:** TypeScript, Drizzle ORM, Vitest, embedded Postgres test harness (`server/src/__tests__/helpers/embedded-postgres.ts`).

## Global Constraints

- No behavior change to `reapOrphanedRuns` internals, the startup reap, the cap resolver, or the gate. This slice only adds a seam and tests.
- The `run-liveness` source uses `staleThresholdMs: 5 * 60 * 1000`, identical to today's periodic reaper call.
- `runReconcile` must be fault-isolated: a source that throws is logged and skipped; remaining sources still run.
- The reconciler owns no timer and no DB access — dependencies are injected. It does not import the heartbeat singleton directly.
- Every new/changed source file must carry the `// [START: module]` / `// [END: module]` nav tags and the FILE/ABOUT + META header block, matching `server/src/services/instance-admission-lock.ts`. Run `python3 scripts/nav/nav_endhook.py` before the final commit.
- No new run status, no `queued_admission`, no admit/defer audit logging — out of scope.

## File Structure

- Create `server/src/services/admission-reconciler.ts` — reconciler types, `runReconcile`, `makeRunLivenessSource`, `phase1ReconcileSources`. One responsibility: orchestrate reconcile sources.
- Create `server/src/services/admission-reconciler.test.ts` — unit tests (fault isolation + run-liveness source delegation). No DB.
- Create `server/src/__tests__/admission-reconciler.test.ts` — Layer-1 integration test (embedded postgres): seeded-orphan cap-reclaim.
- Modify `server/src/index.ts` (periodic sweep, ~877–883) — replace the bare `reapOrphanedRuns` call with `runReconcile`.
- Modify `server/src/__tests__/heartbeat-process-recovery.test.ts` — Layer-2 real-process case driven through `runReconcile`.

---

### Task 1: Reconciler interface + fault isolation

**Files:**
- Create: `server/src/services/admission-reconciler.ts`
- Test: `server/src/services/admission-reconciler.test.ts`

**Interfaces:**
- Consumes: `logger` from `../middleware/logger.js`.
- Produces:
  - `type ReconcileResult = { source: string; drifted: number; repaired: number }`
  - `type ReconcileSource = { name: string; reconcile(now: Date): Promise<ReconcileResult> }`
  - `function runReconcile(sources: ReconcileSource[], now: Date): Promise<ReconcileResult[]>` — runs each source in order, fault-isolated; a throwing source is logged and omitted from results.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/services/admission-reconciler.test.ts
import { describe, expect, it, vi } from "vitest";
import { runReconcile, type ReconcileSource } from "./admission-reconciler.js";

describe("runReconcile", () => {
  it("runs every source and returns their results in order", async () => {
    const now = new Date();
    const a: ReconcileSource = {
      name: "a",
      reconcile: async () => ({ source: "a", drifted: 2, repaired: 2 }),
    };
    const b: ReconcileSource = {
      name: "b",
      reconcile: async () => ({ source: "b", drifted: 0, repaired: 0 }),
    };
    expect(await runReconcile([a, b], now)).toEqual([
      { source: "a", drifted: 2, repaired: 2 },
      { source: "b", drifted: 0, repaired: 0 },
    ]);
  });

  it("isolates a throwing source: it is skipped, later sources still run", async () => {
    const boom: ReconcileSource = {
      name: "boom",
      reconcile: async () => {
        throw new Error("kaboom");
      },
    };
    const ran = vi.fn(async () => ({ source: "ok", drifted: 1, repaired: 1 }));
    const ok: ReconcileSource = { name: "ok", reconcile: ran };
    const results = await runReconcile([boom, ok], new Date());
    expect(ran).toHaveBeenCalledOnce();
    expect(results).toEqual([{ source: "ok", drifted: 1, repaired: 1 }]);
  });

  it("passes the shared now to each source", async () => {
    const now = new Date("2026-07-08T00:00:00.000Z");
    const seen: Date[] = [];
    const src: ReconcileSource = {
      name: "s",
      reconcile: async (n) => {
        seen.push(n);
        return { source: "s", drifted: 0, repaired: 0 };
      },
    };
    await runReconcile([src], now);
    expect(seen).toEqual([now]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/admission-reconciler.test.ts`
Expected: FAIL — cannot find module `./admission-reconciler.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/src/services/admission-reconciler.ts
/**
 * FILE: server/src/services/admission-reconciler.ts
 * ABOUT: admission-reconciler.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - admission-reconciler.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: admission-reconciler.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/admission-reconciler.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { logger } from "../middleware/logger.js";

// One reconcile source's outcome for a single pass. `drifted` = rows detected
// as diverged from ground truth; `repaired` = rows the source actually fixed.
// (For run-liveness these coincide, since the reaper only reports rows it
// reaped; future sources may detect more than they repair.)
export type ReconcileResult = { source: string; drifted: number; repaired: number };

// A reconcile source owns its own drift detection + repair against ground
// truth. Phase 2 (per-run counters) and Phase 4 (leases) add more sources;
// they plug into runReconcile without touching this loop.
export type ReconcileSource = {
  name: string;
  // Must never throw for "nothing to do"; a throw is treated as a source
  // failure and isolated (logged + skipped) so it can't stop other sources.
  reconcile(now: Date): Promise<ReconcileResult>;
};

// Fault-isolating fold over the sources. Owns no timer and no DB access.
export async function runReconcile(
  sources: ReconcileSource[],
  now: Date,
): Promise<ReconcileResult[]> {
  const results: ReconcileResult[] = [];
  for (const source of sources) {
    try {
      results.push(await source.reconcile(now));
    } catch (err) {
      logger.error({ err, source: source.name }, "reconcile source failed; skipping");
    }
  }
  return results;
}
// [END: module]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/services/admission-reconciler.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/admission-reconciler.ts server/src/services/admission-reconciler.test.ts
git commit -m "feat(admission): reconciler source registry with fault isolation"
```

---

### Task 2: Phase-1 run-liveness source (delegates to reaper)

**Files:**
- Modify: `server/src/services/admission-reconciler.ts` (add source factory + phase-1 list)
- Test: `server/src/services/admission-reconciler.test.ts` (add cases)

**Interfaces:**
- Consumes: `ReconcileSource`, `ReconcileResult` (Task 1).
- Produces:
  - `type ReapOrphanedRuns = (opts?: { staleThresholdMs?: number }) => Promise<{ reaped: number; runIds: string[] }>` — the injected subset of the heartbeat service this source needs.
  - `function makeRunLivenessSource(deps: { reapOrphanedRuns: ReapOrphanedRuns }): ReconcileSource` — a source named `"run-liveness"` that calls `reapOrphanedRuns({ staleThresholdMs: 5*60*1000 })` and maps the result.
  - `function phase1ReconcileSources(deps: { reapOrphanedRuns: ReapOrphanedRuns }): ReconcileSource[]` — returns `[makeRunLivenessSource(deps)]`.
  - `const RECONCILE_STALE_THRESHOLD_MS = 5 * 60 * 1000`.

- [ ] **Step 1: Write the failing test** (append to the existing describe block / add a new one)

```typescript
// server/src/services/admission-reconciler.test.ts  (add these imports to the top)
import {
  makeRunLivenessSource,
  phase1ReconcileSources,
  RECONCILE_STALE_THRESHOLD_MS,
} from "./admission-reconciler.js";

describe("run-liveness source", () => {
  it("delegates to reapOrphanedRuns with the 5-minute staleness threshold", async () => {
    const reapOrphanedRuns = vi.fn(async () => ({ reaped: 3, runIds: ["a", "b", "c"] }));
    const source = makeRunLivenessSource({ reapOrphanedRuns });
    const result = await source.reconcile(new Date());
    expect(reapOrphanedRuns).toHaveBeenCalledWith({ staleThresholdMs: RECONCILE_STALE_THRESHOLD_MS });
    expect(RECONCILE_STALE_THRESHOLD_MS).toBe(5 * 60 * 1000);
    expect(source.name).toBe("run-liveness");
    expect(result).toEqual({ source: "run-liveness", drifted: 3, repaired: 3 });
  });

  it("reports zero when nothing is reaped", async () => {
    const reapOrphanedRuns = vi.fn(async () => ({ reaped: 0, runIds: [] as string[] }));
    const result = await makeRunLivenessSource({ reapOrphanedRuns }).reconcile(new Date());
    expect(result).toEqual({ source: "run-liveness", drifted: 0, repaired: 0 });
  });

  it("phase1ReconcileSources contains exactly the run-liveness source", async () => {
    const reapOrphanedRuns = vi.fn(async () => ({ reaped: 0, runIds: [] as string[] }));
    const sources = phase1ReconcileSources({ reapOrphanedRuns });
    expect(sources.map((s) => s.name)).toEqual(["run-liveness"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/admission-reconciler.test.ts -t "run-liveness"`
Expected: FAIL — `makeRunLivenessSource` / `phase1ReconcileSources` / `RECONCILE_STALE_THRESHOLD_MS` not exported.

- [ ] **Step 3: Add the source to `admission-reconciler.ts`**

Insert, before the `// [END: module]` line:

```typescript
// The subset of the heartbeat service the run-liveness source needs. Injected
// (not imported) so the reconciler stays free of the heartbeat singleton.
export type ReapOrphanedRuns = (
  opts?: { staleThresholdMs?: number },
) => Promise<{ reaped: number; runIds: string[] }>;

// Same 5-minute staleness threshold today's periodic reaper call uses, so
// wrapping the reaper in the reconciler changes nothing about when runs reap.
export const RECONCILE_STALE_THRESHOLD_MS = 5 * 60 * 1000;

// Phase-1 source: delegates run-liveness reconciliation to the existing,
// battle-tested reaper (real pid / process-group liveness, detached-process
// handling, retry-once). We do not reimplement any of that here.
export function makeRunLivenessSource(deps: { reapOrphanedRuns: ReapOrphanedRuns }): ReconcileSource {
  return {
    name: "run-liveness",
    async reconcile(_now: Date): Promise<ReconcileResult> {
      const { reaped } = await deps.reapOrphanedRuns({ staleThresholdMs: RECONCILE_STALE_THRESHOLD_MS });
      // reapOrphanedRuns only reports rows it reaped, so drifted === repaired here.
      return { source: "run-liveness", drifted: reaped, repaired: reaped };
    },
  };
}

export function phase1ReconcileSources(deps: { reapOrphanedRuns: ReapOrphanedRuns }): ReconcileSource[] {
  return [makeRunLivenessSource(deps)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/services/admission-reconciler.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/admission-reconciler.ts server/src/services/admission-reconciler.test.ts
git commit -m "feat(admission): run-liveness reconcile source delegating to reaper"
```

---

### Task 3: Layer-1 seeded-orphan cap-reclaim integration test

**Files:**
- Test: `server/src/__tests__/admission-reconciler.test.ts` (new; embedded postgres)

**Interfaces:**
- Consumes: `runReconcile`, `phase1ReconcileSources` (Tasks 1–2); `heartbeatService(db)` (`reapOrphanedRuns`, `countRunningRunsInstanceWide`, `startNextQueuedRunForAgent`); `instanceSettingsService(db).updateGeneral`.
- Produces: proof that one `runReconcile` pass frees slots held by orphaned `running` rows and the gate re-admits up to the cap.

> Mirror the DB bootstrap and helpers from `server/src/__tests__/heartbeat-instance-admission.test.ts` (imports, `describeEmbeddedPostgres`, `beforeAll`/`afterAll`, `createCompany`, `createAgents`, `saturateQueue`, `countRunning`, `runTickForAllAgents`). The one change from that file's `seedOrphanRunningRows`: **backdate `updatedAt`** so the rows are past the 5-minute staleness threshold (the reaper skips fresh `running` rows). Orphan rows use adapter `codex_local` with no `processPid`/`processGroupId`, so the reaper fails them (no live process, no retry).

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/__tests__/admission-reconciler.test.ts
// Bootstrap (imports, describeEmbeddedPostgres, beforeAll/afterAll, createCompany,
// createAgents, saturateQueue, countRunning, runTickForAllAgents) is mirrored verbatim
// from heartbeat-instance-admission.test.ts. Only the two admission-reconciler cases
// and the stale-orphan seed helper below are new.
import { randomUUID } from "node:crypto";
import { agents, heartbeatRuns } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { runReconcile, phase1ReconcileSources } from "../services/admission-reconciler.ts";
import { instanceSettingsService } from "../services/instance-settings.ts";

// ...inside the describeEmbeddedPostgres block, alongside the mirrored helpers:

// Seed `count` orphaned running rows (no live process) whose updatedAt is old
// enough that the reaper's 5-minute staleness gate lets them through.
async function seedStaleOrphanRunningRows(companyId: string, count: number) {
  const orphanAgentId = randomUUID();
  await db.insert(agents).values({
    id: orphanAgentId,
    companyId,
    name: `Orphan-${orphanAgentId.slice(0, 8)}`,
    role: "engineer",
    status: "active",
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
  });
  const staleAt = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
  const ids = Array.from({ length: count }, () => randomUUID());
  await db.insert(heartbeatRuns).values(
    ids.map((id) => ({
      id,
      companyId,
      agentId: orphanAgentId,
      invocationSource: "assignment" as const,
      triggerDetail: "system" as const,
      status: "running" as const,
    })),
  );
  // Backdate updatedAt past the staleness threshold.
  for (const id of ids) {
    await db.update(heartbeatRuns).set({ updatedAt: staleAt }).where(eq(heartbeatRuns.id, id));
  }
}

it("reconciler reclaims slots leaked by orphaned running rows, gate re-admits to cap", async () => {
  const companyId = await createCompany();
  await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });

  // Cap fully consumed by crash-leaked running rows.
  await seedStaleOrphanRunningRows(companyId, 10);
  expect(await countRunning()).toBe(10);

  // Real agents with queued work waiting behind the full cap.
  const agentIds = await createAgents(companyId, 3, { maxConcurrentRuns: 20 });
  await saturateQueue(companyId, agentIds, 20);

  // Before reconcile: cap is full of orphans, nothing admits.
  expect(await runTickForAllAgents(agentIds)).toBe(0);

  // One reconcile pass reaps the dead rows and frees the slots.
  const results = await runReconcile(
    phase1ReconcileSources({ reapOrphanedRuns: heartbeat.reapOrphanedRuns }),
    new Date(),
  );
  expect(results).toEqual([{ source: "run-liveness", drifted: 10, repaired: 10 }]);
  expect(await countRunning()).toBe(0);

  // After reconcile: the gate re-admits up to the instance cap on the next tick.
  expect(await runTickForAllAgents(agentIds)).toBe(10);
});
```

- [ ] **Step 2: Run test to verify it fails (or errors) first without the reconcile call**

Run: `cd server && npx vitest run src/__tests__/admission-reconciler.test.ts`
Expected: PASS once Tasks 1–2 are implemented. To confirm the test actually exercises reclaim, temporarily comment out the `runReconcile(...)` call and re-run: the `countRunning()` assertion should then read `10` (not `0`) and the final `runTickForAllAgents` should read `0` — proving the reconcile step is what frees the slots. Restore the call.

- [ ] **Step 3: (no implementation — this task is the test)**

The reconciler already exists (Tasks 1–2). This task only adds the integration proof.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/admission-reconciler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/__tests__/admission-reconciler.test.ts
git commit -m "test(admission): reconciler reclaims cap slots from orphaned running rows"
```

---

### Task 4: Wire the reconciler into the periodic sweep

**Files:**
- Modify: `server/src/index.ts` (periodic sweep block, ~877–883)

**Interfaces:**
- Consumes: `runReconcile`, `phase1ReconcileSources` (Tasks 1–2); the `heartbeat` handle already constructed at `index.ts:777`; `logger` (already imported).
- Produces: the periodic sweep calls the reaper exactly once per tick, via `runReconcile`. No other change to the sweep chain.

- [ ] **Step 1: Add the import** near the other `./services/*` imports at the top of `server/src/index.ts`

```typescript
import { runReconcile, phase1ReconcileSources } from "./services/admission-reconciler.js";
```

- [ ] **Step 2: Replace the bare reaper call in the periodic sweep**

In the `setInterval(..., config.heartbeatSchedulerIntervalMs)` block, replace:

```typescript
      // Periodically reap orphaned runs (5-min staleness threshold) and make sure
      // persisted queued work is still being driven forward.
      void heartbeat
        .reapOrphanedRuns({ staleThresholdMs: 5 * 60 * 1000 })
        .then(() => heartbeat.promoteDueScheduledRetries())
```

with:

```typescript
      // Periodically reconcile leaked admission state (Phase-1 source: run-liveness,
      // which reaps orphaned runs at the 5-min staleness threshold) and make sure
      // persisted queued work is still being driven forward.
      void runReconcile(
        phase1ReconcileSources({ reapOrphanedRuns: heartbeat.reapOrphanedRuns }),
        new Date(),
      )
        .then((results) => {
          const changed = results.filter((r) => r.repaired > 0);
          if (changed.length > 0) logger.warn({ results: changed }, "admission reconciler repaired drift");
        })
        .then(() => heartbeat.promoteDueScheduledRetries())
```

Leave the rest of the `.then(...)` chain (`resumeQueuedRuns`, `reconcileStrandedAssignedIssues`, `reconcileIssueGraphLiveness`, `reconcileTaskWatchdogs`, `scanSilentActiveRuns`, `sweepStaleIssueLocks`, `reconcileProductivityReviews`, `.catch`) exactly as-is. Do **not** touch the startup reap at `index.ts:785`.

- [ ] **Step 3: Typecheck / build the server**

Run: `cd server && npx tsc --noEmit`
Expected: PASS (no type errors). Confirms `heartbeat.reapOrphanedRuns` matches the injected `ReapOrphanedRuns` signature.

- [ ] **Step 4: Verify the reaper is no longer called directly in the periodic block**

Run: `grep -n "reapOrphanedRuns" server/src/index.ts`
Expected: two matches — the startup reap (~785) and the injected reference inside `phase1ReconcileSources({ reapOrphanedRuns: heartbeat.reapOrphanedRuns })`. There must be **no** standalone `heartbeat.reapOrphanedRuns({ staleThresholdMs... }).then(...)` chain remaining in the `setInterval` block.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(admission): drive periodic reaper through the reconciler seam"
```

---

### Task 5: Layer-2 real-process reclaim through the reconciler

**Files:**
- Modify: `server/src/__tests__/heartbeat-process-recovery.test.ts` (add one case)

**Interfaces:**
- Consumes: the existing real-process bootstrap in that file (spawns detached children, `runningProcesses`, `heartbeatRuns`, the `db`/`heartbeat` handles, the skip-on-unsupported-host guard); `runReconcile`, `phase1ReconcileSources` (Tasks 1–2).
- Produces: proof that reclaim through `runReconcile` behaves identically to the raw reaper on the real-process path (dead run → `failed`, slot freed).

> Reuse this file's existing helpers for spawning a real detached process as a `running` heartbeat run and for asserting run status. Model the new case on the existing orphaned-process recovery case, but drive reclaim through `runReconcile(phase1ReconcileSources({ reapOrphanedRuns: heartbeat.reapOrphanedRuns }), new Date())` instead of calling `heartbeat.reapOrphanedRuns(...)` directly. Insert `<the file's existing helper to create a running run backed by a real, then-killed process>` and `<its status-fetch helper>` — grep the file for the helper names already used by the neighboring recovery cases and reuse them verbatim.

- [ ] **Step 1: Add the failing test case**

```typescript
// server/src/__tests__/heartbeat-process-recovery.test.ts
// Added inside the existing describeEmbeddedPostgres("heartbeat orphaned process recovery", ...) block.
// Reuse the SAME helpers the neighboring recovery cases use to (a) create a running run backed by a
// real spawned process and register it in runningProcesses, and (b) read a run's status back.
import { runReconcile, phase1ReconcileSources } from "../services/admission-reconciler.ts";

it("reclaims a run whose real process died, driven through the reconciler seam", async () => {
  // 1. Create a running heartbeat run backed by a real detached child process,
  //    using this file's existing spawn+register helper. Capture its runId.
  //    (Same setup the adjacent 'reaps orphaned process' case performs.)
  const { runId } = await /* existing helper: spawn a real running run */;

  // 2. Kill the process and drop the in-memory handle so it looks crash-leaked,
  //    and backdate updatedAt past the 5-minute staleness threshold — exactly as
  //    the neighboring reaper case does before invoking recovery.
  //    (Reuse the file's existing kill + runningProcesses.delete + backdate steps.)

  // 3. Drive reclaim through the reconciler instead of calling reapOrphanedRuns directly.
  const results = await runReconcile(
    phase1ReconcileSources({ reapOrphanedRuns: heartbeat.reapOrphanedRuns }),
    new Date(),
  );

  // 4. The seam reports the reclaim, and the row is now failed (slot freed).
  expect(results).toEqual([{ source: "run-liveness", drifted: 1, repaired: 1 }]);
  const status = await /* existing helper: fetch run status by id */(runId);
  expect(status).toBe("failed");
});
```

- [ ] **Step 2: Fill in the helper calls**

Replace the `/* existing helper ... */` placeholders with the actual helper names/signatures used by the neighboring recovery cases in this file (grep the file for how the current "reaps orphaned process" case spawns a run, kills it, backdates `updatedAt`, and reads status back — reuse those verbatim). The new case must not introduce its own spawn/kill/status utilities.

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/heartbeat-process-recovery.test.ts -t "reconciler seam"`
Expected: PASS on supported hosts (inherits the file's skip guard on unsupported hosts).

- [ ] **Step 4: Sync nav tags**

Run: `python3 scripts/nav/nav_endhook.py`
Expected: updates `nav/` for the new `admission-reconciler.ts` module.

- [ ] **Step 5: Commit**

```bash
git add server/src/__tests__/heartbeat-process-recovery.test.ts nav/
git commit -m "test(admission): real-process reclaim through the reconciler seam"
```

---

### Task 6: Full-suite regression check

**Files:** none (verification only).

- [ ] **Step 1: Run the admission + recovery suites**

Run:
```bash
cd server && npx vitest run \
  src/services/admission-reconciler.test.ts \
  src/__tests__/admission-reconciler.test.ts \
  src/__tests__/heartbeat-instance-admission.test.ts \
  src/__tests__/heartbeat-process-recovery.test.ts
```
Expected: PASS (recovery suite may report skipped on unsupported hosts). Proves the reconciler seam, the cap-reclaim behavior, the untouched gate, and the real-process reaper all still work.

- [ ] **Step 2: Typecheck the whole server package**

Run: `cd server && npx tsc --noEmit`
Expected: PASS.

---

## Self-review notes

- **Spec coverage:** reconciler interface + fault isolation (Task 1); run-liveness source delegating to reaper, 5-min threshold (Task 2); Layer-1 seeded-orphan cap-reclaim test (Task 3); single-timer integration replacing the bare reaper call (Task 4); Layer-2 real-process reclaim through the seam (Task 5); regression check (Task 6). Out-of-scope items (per-run counters, leases, audit logging, run-status changes) are absent by construction.
- **Type consistency:** `ReconcileResult` `{ source, drifted, repaired }` and `ReconcileSource.reconcile(now)` are defined in Task 1 and used unchanged in Tasks 2–5. `ReapOrphanedRuns` (Task 2) matches `heartbeat.reapOrphanedRuns`'s real return `{ reaped: number; runIds: string[] }` (verified at `heartbeat.ts:8048`). `phase1ReconcileSources({ reapOrphanedRuns })` and `runReconcile(sources, now)` signatures are identical across the integration test, index wiring, and process-recovery test.
- **Conventions:** new source file carries the FILE/ABOUT + META + `[START/END: module]` block; `nav_endhook.py` runs in Task 5 before its commit.
