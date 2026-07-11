# Wind-Down Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared `windDownRun` primitive that stops an in-flight heartbeat run either softly (let the turn finish) or hard (terminate but leave the work resumable), so Phase 2a (per-run caps) and Phase 2c (Panic/Drain) consume it instead of hard-killing work.

**Architecture:** A dependency-injected pure module (`run-wind-down.ts`) holds the orchestration logic and a crash-safety reconcile source; it knows nothing about the heartbeat singleton. The heartbeat service wires concrete dependencies onto its existing internals (`terminateHeartbeatRunProcess`, `setRunStatus`, `refreshIssueContinuationSummary`, `releaseIssueExecutionAndPromote`) and exposes a bound `windDownRun`. This mirrors the established `admission-reconciler.ts` pattern.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Vitest. Design spec: `docs/superpowers/specs/2026-07-11-wind-down-primitive-design.md`.

## Global Constraints

- No product caller/endpoint in this phase — 2.0 ships pure substrate proven by tests. (spec: Scope)
- `heartbeat_runs.status` is a free-text column; the new `wound_down` value needs **no** DB enum migration — only the two new columns do. (spec: Design decision 3)
- Soft-wound-down runs keep terminal status `finished`; `wound_down` is reserved for the hard cut. (spec: Design decision 4)
- Follow the injected-deps + fake-deps-unit-test pattern of `server/src/services/admission-reconciler.ts` and its `.test.ts`. (spec: Interface)
- Reason values are exactly `"cap-wallclock" | "cap-cost" | "panic" | "drain"`; resume values exactly `"when-allowed" | "no"`. (spec: Interface)
- Run tests with: `cd server && npx vitest run <path>` (single file). Generate migrations with `pnpm db:generate` from repo root.

---

### Task 1: Schema — add `windDownReason` + `resumePolicy` columns

**Files:**
- Modify: `packages/db/src/schema/heartbeat_runs.ts`
- Create: `packages/db/src/migrations/0107_wind_down_run_fields.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: `heartbeatRuns.windDownReason` (nullable text) and `heartbeatRuns.resumePolicy` (nullable text) on the Drizzle table, available via `typeof heartbeatRuns.$inferSelect`.

- [ ] **Step 1: Add the two columns to the schema**

In `packages/db/src/schema/heartbeat_runs.ts`, alongside the existing `status` / liveness columns, add:

```ts
    // Combo-01 Phase 2.0 wind-down substrate. Both nullable: only set when a run
    // is wound down (hard) or marked with soft wind-down intent.
    windDownReason: text("wind_down_reason"),
    // "when-allowed" | "no" — resume policy supplied by the wind-down caller.
    resumePolicy: text("resume_policy"),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `packages/db/src/migrations/0107_wind_down_run_fields.sql` containing `ALTER TABLE "heartbeat_runs" ADD COLUMN "wind_down_reason" text;` and `ADD COLUMN "resume_policy" text;`, plus an updated `meta/_journal.json` entry tagged `0107_wind_down_run_fields`.

(If drizzle-kit names it differently, rename the `.sql` to `0107_wind_down_run_fields.sql` and update the `_journal.json` tag to match.)

- [ ] **Step 3: Typecheck the db package**

Run: `pnpm --filter @paperclipai/db build`
Expected: PASS (compiles, migrations copied).

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/heartbeat_runs.ts packages/db/src/migrations/
git commit -m "feat(db): add wind_down_reason and resume_policy to heartbeat_runs"
```

---

### Task 2: The `windDownRun` primitive (pure module + fake-deps tests)

**Files:**
- Create: `server/src/services/run-wind-down.ts`
- Create: `server/src/services/run-wind-down.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `type WindDownMode = "soft" | "hard"`
  - `type ResumePolicy = "when-allowed" | "no"`
  - `type WindDownReason = "cap-wallclock" | "cap-cost" | "panic" | "drain"`
  - `type WindDownRunRow = { id: string; status: string; agentId: string }`
  - `type WindDownOutcome = "terminated" | "marked-soft" | "noop"`
  - `type WindDownDeps = { getRun; captureContinuation; terminateProcess; markWoundDown; markSoftIntent; releaseIssue }` (signatures in Step 3)
  - `async function windDownRun(deps: WindDownDeps, runId: string, opts: { mode: WindDownMode; resume: ResumePolicy; reason: WindDownReason }): Promise<{ outcome: WindDownOutcome }>`
  - `const STOPPABLE_WIND_DOWN_STATUSES: readonly string[]`

- [ ] **Step 1: Write the failing tests**

Create `server/src/services/run-wind-down.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  STOPPABLE_WIND_DOWN_STATUSES,
  windDownRun,
  type WindDownDeps,
  type WindDownRunRow,
} from "./run-wind-down.js";

function makeDeps(run: WindDownRunRow | null) {
  const calls: string[] = [];
  const deps: WindDownDeps = {
    getRun: vi.fn(async () => run),
    captureContinuation: vi.fn(async () => {
      calls.push("capture");
    }),
    terminateProcess: vi.fn(async () => {
      calls.push("terminate");
    }),
    markWoundDown: vi.fn(async () => {
      calls.push("markWoundDown");
    }),
    markSoftIntent: vi.fn(async () => {
      calls.push("markSoftIntent");
    }),
    releaseIssue: vi.fn(async (_run, opts) => {
      calls.push(`release:${opts.reenqueue}`);
    }),
  };
  return { deps, calls };
}

const RUN: WindDownRunRow = { id: "run-1", status: "running", agentId: "agent-1" };

describe("windDownRun", () => {
  it("noops when the run is missing", async () => {
    const { deps } = makeDeps(null);
    expect(await windDownRun(deps, "run-1", { mode: "hard", resume: "no", reason: "panic" })).toEqual({
      outcome: "noop",
    });
    expect(deps.terminateProcess).not.toHaveBeenCalled();
  });

  it("noops when the run is in a non-stoppable status", async () => {
    const { deps } = makeDeps({ id: "run-1", status: "finished", agentId: "agent-1" });
    expect(await windDownRun(deps, "run-1", { mode: "hard", resume: "no", reason: "panic" })).toEqual({
      outcome: "noop",
    });
    expect(deps.terminateProcess).not.toHaveBeenCalled();
  });

  it("hard + when-allowed: captures before terminating, marks wound_down, re-enqueues", async () => {
    const { deps, calls } = makeDeps(RUN);
    const result = await windDownRun(deps, "run-1", {
      mode: "hard",
      resume: "when-allowed",
      reason: "cap-cost",
    });
    expect(result).toEqual({ outcome: "terminated" });
    expect(calls).toEqual(["capture", "terminate", "markWoundDown", "release:true"]);
    expect(deps.markWoundDown).toHaveBeenCalledWith("run-1", "cap-cost", "when-allowed");
  });

  it("hard + no: marks wound_down, releases WITHOUT re-enqueue", async () => {
    const { deps, calls } = makeDeps(RUN);
    const result = await windDownRun(deps, "run-1", { mode: "hard", resume: "no", reason: "panic" });
    expect(result).toEqual({ outcome: "terminated" });
    expect(calls).toEqual(["capture", "terminate", "markWoundDown", "release:false"]);
  });

  it("soft: records intent only, no process action", async () => {
    const { deps, calls } = makeDeps(RUN);
    const result = await windDownRun(deps, "run-1", { mode: "soft", resume: "no", reason: "drain" });
    expect(result).toEqual({ outcome: "marked-soft" });
    expect(calls).toEqual(["markSoftIntent"]);
    expect(deps.markSoftIntent).toHaveBeenCalledWith("run-1", "drain", "no");
    expect(deps.terminateProcess).not.toHaveBeenCalled();
    expect(deps.captureContinuation).not.toHaveBeenCalled();
  });

  it("exposes the stoppable status set", () => {
    expect(STOPPABLE_WIND_DOWN_STATUSES).toEqual(["queued", "running", "scheduled_retry"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run src/services/run-wind-down.test.ts`
Expected: FAIL — cannot resolve `./run-wind-down.js` (module does not exist).

- [ ] **Step 3: Write the primitive**

Create `server/src/services/run-wind-down.ts`:

```ts
// Combo-01 Phase 2.0: the shared graceful wind-down primitive. Stops one
// in-flight heartbeat run either softly (let the current turn finish, then
// don't continue it) or hard (terminate the turn now, capture a continuation
// artifact, and re-enqueue the work per the caller's resume policy).
//
// Pure + dependency-injected: it never touches the heartbeat singleton or the
// DB directly. The heartbeat service wires concrete deps (see heartbeat.ts).

export type WindDownMode = "soft" | "hard";
export type ResumePolicy = "when-allowed" | "no";
export type WindDownReason = "cap-wallclock" | "cap-cost" | "panic" | "drain";
export type WindDownOutcome = "terminated" | "marked-soft" | "noop";

// The minimal run shape the primitive needs. Concrete deps map the full
// heartbeat_runs row down to this.
export type WindDownRunRow = { id: string; status: string; agentId: string };

// Only runs in one of these statuses can be wound down; anything already
// terminal is a noop.
export const STOPPABLE_WIND_DOWN_STATUSES: readonly string[] = ["queued", "running", "scheduled_retry"];

export type WindDownDeps = {
  getRun(runId: string): Promise<WindDownRunRow | null>;
  // Snapshot last-known state to the issue continuation summary BEFORE the kill.
  captureContinuation(run: WindDownRunRow): Promise<void>;
  // Terminate the OS process (grace window) and drop it from the in-memory map.
  terminateProcess(run: WindDownRunRow): Promise<void>;
  // Set status=wound_down + windDownReason + resumePolicy + finishedAt, notify.
  markWoundDown(runId: string, reason: WindDownReason, resume: ResumePolicy): Promise<void>;
  // Soft mode: persist intent on the still-running row; do NOT change status.
  markSoftIntent(runId: string, reason: WindDownReason, resume: ResumePolicy): Promise<void>;
  // Release the issue execution lock; reenqueue=true promotes a continuation run,
  // reenqueue=false parks the work.
  releaseIssue(run: WindDownRunRow, opts: { reenqueue: boolean }): Promise<void>;
};

export async function windDownRun(
  deps: WindDownDeps,
  runId: string,
  opts: { mode: WindDownMode; resume: ResumePolicy; reason: WindDownReason },
): Promise<{ outcome: WindDownOutcome }> {
  const run = await deps.getRun(runId);
  if (!run || !STOPPABLE_WIND_DOWN_STATUSES.includes(run.status)) {
    return { outcome: "noop" };
  }

  if (opts.mode === "soft") {
    await deps.markSoftIntent(runId, opts.reason, opts.resume);
    return { outcome: "marked-soft" };
  }

  // Hard: capture continuation FIRST so we snapshot last-known state before the
  // process dies, then terminate, mark, and release per resume policy.
  await deps.captureContinuation(run);
  await deps.terminateProcess(run);
  await deps.markWoundDown(runId, opts.reason, opts.resume);
  await deps.releaseIssue(run, { reenqueue: opts.resume === "when-allowed" });
  return { outcome: "terminated" };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run src/services/run-wind-down.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/run-wind-down.ts server/src/services/run-wind-down.test.ts
git commit -m "feat(heartbeat): add windDownRun primitive (soft/hard modes)"
```

---

### Task 3: The `wound-down-resume` reconcile source + soft-finish helper (pure + fake-deps tests)

**Files:**
- Modify: `server/src/services/run-wind-down.ts`
- Modify: `server/src/services/run-wind-down.test.ts`

**Interfaces:**
- Consumes: `ReconcileSource`, `ReconcileResult` from `./admission-reconciler.js`.
- Produces:
  - `type OrphanedWoundDownRun = { id: string; agentId: string }`
  - `type WoundDownResumeDeps = { findResumableOrphans(now: Date): Promise<OrphanedWoundDownRun[]>; reenqueueOrphan(run: OrphanedWoundDownRun): Promise<void> }`
  - `function makeWoundDownResumeSource(deps: WoundDownResumeDeps): ReconcileSource` — name `"wound-down-resume"`.
  - `function shouldSuppressContinuationOnFinish(run: { windDownReason: string | null; resumePolicy: string | null }): boolean` — the soft-finish branch, extracted so it is unit-testable without the heartbeat harness.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/services/run-wind-down.test.ts`:

```ts
import { makeWoundDownResumeSource, type OrphanedWoundDownRun } from "./run-wind-down.js";

describe("wound-down-resume reconcile source", () => {
  it("re-enqueues every resumable orphan and reports the count", async () => {
    const orphans: OrphanedWoundDownRun[] = [
      { id: "r1", agentId: "a1" },
      { id: "r2", agentId: "a2" },
    ];
    const reenqueueOrphan = vi.fn(async () => {});
    const source = makeWoundDownResumeSource({
      findResumableOrphans: vi.fn(async () => orphans),
      reenqueueOrphan,
    });
    const result = await source.reconcile(new Date());
    expect(source.name).toBe("wound-down-resume");
    expect(reenqueueOrphan).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ source: "wound-down-resume", drifted: 2, repaired: 2 });
  });

  it("reports zero when nothing is resumable", async () => {
    const source = makeWoundDownResumeSource({
      findResumableOrphans: vi.fn(async () => []),
      reenqueueOrphan: vi.fn(async () => {}),
    });
    expect(await source.reconcile(new Date())).toEqual({
      source: "wound-down-resume",
      drifted: 0,
      repaired: 0,
    });
  });
});

import { shouldSuppressContinuationOnFinish } from "./run-wind-down.js";

describe("shouldSuppressContinuationOnFinish", () => {
  it("suppresses continuation for a soft wind-down with resume=no", () => {
    expect(shouldSuppressContinuationOnFinish({ windDownReason: "drain", resumePolicy: "no" })).toBe(true);
  });

  it("allows normal promotion for a soft wind-down with resume=when-allowed", () => {
    expect(
      shouldSuppressContinuationOnFinish({ windDownReason: "drain", resumePolicy: "when-allowed" }),
    ).toBe(false);
  });

  it("allows normal promotion for an ordinary finish (no wind-down intent)", () => {
    expect(shouldSuppressContinuationOnFinish({ windDownReason: null, resumePolicy: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run src/services/run-wind-down.test.ts`
Expected: FAIL — `makeWoundDownResumeSource` and `shouldSuppressContinuationOnFinish` are not exported.

- [ ] **Step 3: Add the reconcile source and the soft-finish helper**

Append to `server/src/services/run-wind-down.ts`:

```ts
// The soft-finish branch: a run that completed its turn naturally but carries a
// soft wind-down intent with resume="no" must NOT promote a continuation. Any
// other case (no intent, or resume="when-allowed") promotes normally. Extracted
// as a pure function so the heartbeat finish path stays a one-liner and this
// decision is unit-tested without the DB harness.
export function shouldSuppressContinuationOnFinish(run: {
  windDownReason: string | null;
  resumePolicy: string | null;
}): boolean {
  return run.windDownReason != null && run.resumePolicy === "no";
}
```

Then append the reconcile source to `server/src/services/run-wind-down.ts`:

```ts
import type { ReconcileResult, ReconcileSource } from "./admission-reconciler.js";

// A run wound down with resume="when-allowed" whose issue has no active/queued
// continuation — e.g. the process crashed between terminate and re-enqueue.
export type OrphanedWoundDownRun = { id: string; agentId: string };

export type WoundDownResumeDeps = {
  // Ground-truth query: wound_down + resumePolicy="when-allowed" rows whose issue
  // has no active/queued continuation run.
  findResumableOrphans(now: Date): Promise<OrphanedWoundDownRun[]>;
  reenqueueOrphan(run: OrphanedWoundDownRun): Promise<void>;
};

// Crash-safety source for the Phase-1 admission reconciler: re-enqueues resumable
// wound-down runs whose continuation never got scheduled. Runs with
// resumePolicy="no" are intentionally left alone.
export function makeWoundDownResumeSource(deps: WoundDownResumeDeps): ReconcileSource {
  return {
    name: "wound-down-resume",
    async reconcile(now: Date): Promise<ReconcileResult> {
      const orphans = await deps.findResumableOrphans(now);
      let repaired = 0;
      for (const orphan of orphans) {
        await deps.reenqueueOrphan(orphan);
        repaired += 1;
      }
      return { source: "wound-down-resume", drifted: orphans.length, repaired };
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run src/services/run-wind-down.test.ts`
Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/run-wind-down.ts server/src/services/run-wind-down.test.ts
git commit -m "feat(heartbeat): add wound-down-resume reconcile source + soft-finish helper"
```

---

### Task 4: Wire concrete deps into the heartbeat service + soft-intent finish path

**Files:**
- Modify: `server/src/services/heartbeat.ts`

**Interfaces:**
- Consumes: `windDownRun`, `WindDownDeps`, `WindDownRunRow`, `WindDownReason`, `ResumePolicy` from `./run-wind-down.js`.
- Produces on the heartbeat service object:
  - `windDownRun(runId: string, opts: { mode: WindDownMode; resume: ResumePolicy; reason: WindDownReason }): Promise<{ outcome: WindDownOutcome }>`
  - `findResumableWoundDownOrphans(now: Date): Promise<OrphanedWoundDownRun[]>`
  - `reenqueueWoundDownOrphan(run: OrphanedWoundDownRun): Promise<void>`

- [ ] **Step 1: Import the primitive**

At the top of `server/src/services/heartbeat.ts`, near the other service imports, add:

```ts
import {
  shouldSuppressContinuationOnFinish,
  windDownRun as windDownRunCore,
  type OrphanedWoundDownRun,
  type ResumePolicy,
  type WindDownMode,
  type WindDownOutcome,
  type WindDownReason,
  type WindDownRunRow,
} from "./run-wind-down.js";
```

- [ ] **Step 2: Build the concrete deps + bound methods inside `heartbeatService`**

Inside the `heartbeatService(db)` factory (where `cancelRunInternal` and friends are defined, near `heartbeat.ts:11908`), add a deps object and three functions. The termination and continuation logic reuse existing internals:

```ts
  function toWindDownRow(run: typeof heartbeatRuns.$inferSelect): WindDownRunRow {
    return { id: run.id, status: run.status, agentId: run.agentId };
  }

  const windDownDeps = {
    getRun: async (runId: string): Promise<WindDownRunRow | null> => {
      const run = await getRun(runId);
      return run ? toWindDownRow(run) : null;
    },
    captureContinuation: async (row: WindDownRunRow): Promise<void> => {
      const run = await getRun(row.id);
      if (!run) return;
      const issueId = readNonEmptyString(parseObject(run.contextSnapshot).issueId);
      const agent = await getAgent(run.agentId);
      if (!issueId || !agent) return; // nothing to resume against; continuation is best-effort
      await refreshIssueContinuationSummary({ db, issueId, run, agent });
    },
    terminateProcess: async (row: WindDownRunRow): Promise<void> => {
      const run = await getRun(row.id);
      if (!run) return;
      const running = runningProcesses.get(run.id);
      try {
        if (running) {
          await terminateHeartbeatRunProcess({
            pid: running.child.pid ?? run.processPid,
            processGroupId: running.processGroupId ?? run.processGroupId,
            graceMs: Math.max(1, running.graceSec) * 1000,
          });
        } else if (run.processPid || run.processGroupId) {
          await terminateHeartbeatRunProcess({ pid: run.processPid, processGroupId: run.processGroupId });
        }
      } finally {
        runningProcesses.delete(run.id);
      }
    },
    markWoundDown: async (runId: string, reason: WindDownReason, resume: ResumePolicy): Promise<void> => {
      const finishedAt = new Date();
      const updated = await setRunStatus(runId, "wound_down", {
        finishedAt,
        error: `Wound down: ${reason}`,
        errorCode: "wound_down",
        windDownReason: reason,
        resumePolicy: resume,
      });
      if (updated) {
        await setWakeupStatus(updated.wakeupRequestId, "cancelled", { finishedAt, error: `Wound down: ${reason}` });
        await appendRunEvent(updated, 1, {
          eventType: "lifecycle",
          stream: "system",
          level: "warn",
          message: "run wound down",
          payload: { reason, resume },
        });
      }
    },
    markSoftIntent: async (runId: string, reason: WindDownReason, resume: ResumePolicy): Promise<void> => {
      await db
        .update(heartbeatRuns)
        .set({ windDownReason: reason, resumePolicy: resume, updatedAt: new Date() })
        .where(eq(heartbeatRuns.id, runId));
    },
    releaseIssue: async (row: WindDownRunRow, opts: { reenqueue: boolean }): Promise<void> => {
      const run = await getRun(row.id);
      if (!run) return;
      await releaseIssueExecutionAndPromote(run, opts.reenqueue ? {} : { suppressImmediateRecovery: true });
    },
  };

  async function windDownRun(
    runId: string,
    opts: { mode: WindDownMode; resume: ResumePolicy; reason: WindDownReason },
  ): Promise<{ outcome: WindDownOutcome }> {
    return windDownRunCore(windDownDeps, runId, opts);
  }

  async function findResumableWoundDownOrphans(_now: Date): Promise<OrphanedWoundDownRun[]> {
    // wound_down + resumePolicy="when-allowed" whose issue has no active/queued
    // continuation run (execution_run_id points nowhere live).
    const rows = await db
      .select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.status, "wound_down"),
          eq(heartbeatRuns.resumePolicy, "when-allowed"),
          sql`not exists (
            select 1 from ${heartbeatRuns} live
            where live.company_id = ${heartbeatRuns.companyId}
              and live.status in ('queued', 'running', 'scheduled_retry')
              and live.context_snapshot->>'issueId' = ${heartbeatRuns.contextSnapshot}->>'issueId'
          )`,
        ),
      );
    return rows;
  }

  async function reenqueueWoundDownOrphan(orphan: OrphanedWoundDownRun): Promise<void> {
    const run = await getRun(orphan.id);
    if (!run) return;
    await releaseIssueExecutionAndPromote(run);
  }
```

Then, in the returned service object (the `return { ... }` at the end of `heartbeatService`), add:

```ts
    windDownRun,
    findResumableWoundDownOrphans,
    reenqueueWoundDownOrphan,
```

- [ ] **Step 3: Make the soft-intent finish path honor `resume: "no"`**

At `server/src/services/heartbeat.ts:8120`, replace the plain release call:

```ts
      } else {
        await releaseIssueExecutionAndPromote(finalizedRun);
      }
```

with one that suppresses continuation when a soft wind-down asked for no resume:

```ts
      } else {
        await releaseIssueExecutionAndPromote(
          finalizedRun,
          shouldSuppressContinuationOnFinish(finalizedRun) ? { suppressImmediateRecovery: true } : {},
        );
      }
```

- [ ] **Step 4: Typecheck the server**

Run: `cd server && pnpm typecheck`
Expected: PASS. (If `sql`, `and`, `eq`, `parseObject`, `readNonEmptyString`, `refreshIssueContinuationSummary` are not already imported in heartbeat.ts, add them — they are used elsewhere in the same file, so imports already exist; verify with `grep -n "readNonEmptyString\|refreshIssueContinuationSummary" server/src/services/heartbeat.ts`.)

- [ ] **Step 5: Run the existing heartbeat unit tests to confirm no regression**

Run: `cd server && npx vitest run src/services/run-wind-down.test.ts src/services/admission-reconciler.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/heartbeat.ts
git commit -m "feat(heartbeat): wire windDownRun deps and soft-intent finish path"
```

---

### Task 5: Register the reconcile source + DB-backed integration proof

**Files:**
- Modify: `server/src/index.ts:895-896`
- Create: `server/src/__tests__/run-wind-down.integration.test.ts`

**Interfaces:**
- Consumes: `heartbeat.windDownRun`, `heartbeat.findResumableWoundDownOrphans`, `heartbeat.reenqueueWoundDownOrphan` (Task 4); `makeWoundDownResumeSource` (Task 3); `phase1ReconcileSources`, `runReconcile` (existing).
- Produces: the periodic reconcile loop now also runs the `wound-down-resume` source.

- [ ] **Step 1: Register the source in the reconcile loop**

In `server/src/index.ts`, import `makeWoundDownResumeSource`:

```ts
import { makeWoundDownResumeSource } from "./services/run-wind-down.js";
```

At `index.ts:895`, extend the source list passed to `runReconcile`:

```ts
      void runReconcile(
        [
          ...phase1ReconcileSources({ reapOrphanedRuns: heartbeat.reapOrphanedRuns }),
          makeWoundDownResumeSource({
            findResumableOrphans: heartbeat.findResumableWoundDownOrphans,
            reenqueueOrphan: heartbeat.reenqueueWoundDownOrphan,
          }),
        ],
```

(Preserve the existing second argument to `runReconcile` — the `now`/timestamp — and any trailing arguments exactly as they are.)

- [ ] **Step 2: Write the failing integration test**

Create `server/src/__tests__/run-wind-down.integration.test.ts`. The embedded-postgres bootstrap (adapter mock, `getEmbeddedPostgresTestSupport`, `beforeAll`/`afterEach`/`afterAll` teardown, and the `createCompany` / `createAgent` seed helpers) is **copied verbatim from `server/src/__tests__/admission-reconciler.test.ts`** (see its lines 24–120 and the helper block below the `beforeAll`). Only the seeding of a single `running` heartbeat run and the assertion below are new:

```ts
// After the shared bootstrap, inside describeEmbeddedPostgres(...):

it("hard wind-down with resume=when-allowed marks the run wound_down and re-enqueues", async () => {
  const company = await createCompany();
  const agent = await createAgent(company.id);

  const runId = randomUUID();
  await db.insert(heartbeatRuns).values({
    id: runId,
    companyId: company.id,
    agentId: agent.id,
    status: "running",
    startedAt: new Date(),
    // contextSnapshot with an issueId is optional here: captureContinuation is
    // best-effort and returns early when no issue is attached.
  });

  const result = await heartbeat.windDownRun(runId, {
    mode: "hard",
    resume: "when-allowed",
    reason: "cap-cost",
  });
  expect(result).toEqual({ outcome: "terminated" });

  const [row] = await db
    .select({
      status: heartbeatRuns.status,
      windDownReason: heartbeatRuns.windDownReason,
      resumePolicy: heartbeatRuns.resumePolicy,
      finishedAt: heartbeatRuns.finishedAt,
    })
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.id, runId));

  expect(row.status).toBe("wound_down");
  expect(row.windDownReason).toBe("cap-cost");
  expect(row.resumePolicy).toBe("when-allowed");
  expect(row.finishedAt).not.toBeNull();
});

it("hard wind-down with resume=no parks the work (wound_down, no resume policy to promote)", async () => {
  const company = await createCompany();
  const agent = await createAgent(company.id);
  const runId = randomUUID();
  await db.insert(heartbeatRuns).values({
    id: runId,
    companyId: company.id,
    agentId: agent.id,
    status: "running",
    startedAt: new Date(),
  });

  const result = await heartbeat.windDownRun(runId, { mode: "hard", resume: "no", reason: "panic" });
  expect(result).toEqual({ outcome: "terminated" });

  const [row] = await db
    .select({ status: heartbeatRuns.status, resumePolicy: heartbeatRuns.resumePolicy })
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.id, runId));
  expect(row.status).toBe("wound_down");
  expect(row.resumePolicy).toBe("no");
});
```

If `createCompany` / `createAgent` in the source test are named differently or take different arguments, copy their exact definitions from `server/src/__tests__/admission-reconciler.test.ts` and use those names.

- [ ] **Step 3: Run the integration test to verify it fails, then passes**

Run: `cd server && npx vitest run src/__tests__/run-wind-down.integration.test.ts`
Expected on a Postgres-capable host: initially FAIL if any wiring is missing, PASS once Tasks 1–4 are in. On a host without embedded Postgres, the suite is `describe.skip` and reports 0 run / skipped — that is acceptable (matches the existing reconciler integration test).

- [ ] **Step 4: Typecheck**

Run: `cd server && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/src/__tests__/run-wind-down.integration.test.ts
git commit -m "feat(heartbeat): register wound-down-resume reconcile source + integration test"
```

---

## Done criteria

- `windDownRun(deps, runId, { mode, resume, reason })` exists as a pure, injected-deps primitive with soft/hard modes and caller-supplied resume policy, fully covered by fake-deps unit tests.
- Hard wind-down captures continuation before terminating, marks the run `wound_down` with reason + resume policy, and re-enqueues iff `resume === "when-allowed"`.
- Soft wind-down records intent only; the natural-finish path suppresses continuation when `resume === "no"`; the run stays `finished`.
- A `wound-down-resume` reconcile source is registered in the periodic loop and re-enqueues resumable orphans after a crash.
- `heartbeat_runs` has `wind_down_reason` + `resume_policy` columns via migration `0107`.
- No product endpoint/caller was added — 2a and 2c will consume `heartbeat.windDownRun`.
