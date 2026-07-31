# Combo-03 Phase 1 — Run-signal read model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the run↔issue join and per-issue run aggregates out of `productivity-review.ts` into a shared `run-signals` read model that the remaining Health Sentinel detectors will consume.

**Architecture:** A read-only service under `server/src/services/run-signals/`. `scope.ts` owns the join predicate and run status sets; `issue-signals.ts` owns batched per-issue aggregation; `index.ts` is a thin facade. `productivity-review.ts` is then ported onto it, which is the proof the interface is sufficient. No new tables, no migration, no new runtime dependency.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Drizzle ORM over Postgres, Vitest, embedded-postgres for DB tests.

## Global Constraints

- **No new tables, no migration, no new runtime dependency.** This phase is pure read model.
- **`server/src/__tests__/productivity-review-service.test.ts` must stay green with zero edits.** It is the behaviour-preservation proof. If a test needs changing, the refactor is wrong — stop and reconsider, do not edit the test.
- Every public function is company-scoped: `companyId` is a required leading argument.
- Import specifiers end in `.js` even for `.ts` sources (ESM/NodeNext) — match surrounding files.
- Every new file carries the repo's `FILE:` / `ABOUT:` / `SECTIONS:` header block and `[START: module]` / `[END: module]` tags. Copy the shape from `server/src/services/productivity-review.ts:1-14`.
- Shared types get the dual barrel export: declare in `packages/shared/src/types/<name>.ts`, then re-export from `packages/shared/src/types/index.ts`.
- No API route and no UI in this phase.

---

### Task 1: Extract the scope predicate and run status sets

Pure extraction. No behaviour change, no consumer change yet.

**Files:**
- Create: `server/src/services/run-signals/scope.ts`
- Test: `server/src/__tests__/run-signals-scope.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `issueRunScopeSql(issueId: string): SQL` — matches a `heartbeat_runs` row whose `contextSnapshot` attributes it to `issueId`.
  - `TERMINAL_RUN_STATUSES: readonly ["succeeded", "failed", "cancelled", "timed_out"]`
  - `ACTIVE_RUN_STATUSES: readonly ["queued", "running", "scheduled_retry"]`
  - `MAX_RUNS_FOR_STREAK: 100`
  - `isTerminalRunStatus(status: string): boolean`
  - `isActiveRunStatus(status: string): boolean`

- [ ] **Step 1: Write the failing test**

The predicate matches three `contextSnapshot` key variants. Each gets a case, because the reason this extraction exists is that the key list is easy to get wrong.

Create `server/src/__tests__/run-signals-scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ACTIVE_RUN_STATUSES,
  isActiveRunStatus,
  isTerminalRunStatus,
  MAX_RUNS_FOR_STREAK,
  TERMINAL_RUN_STATUSES,
} from "../services/run-signals/scope.ts";

describe("run-signals scope constants", () => {
  it("treats every terminal status as terminal and not active", () => {
    for (const status of TERMINAL_RUN_STATUSES) {
      expect(isTerminalRunStatus(status)).toBe(true);
      expect(isActiveRunStatus(status)).toBe(false);
    }
  });

  it("treats every active status as active and not terminal", () => {
    for (const status of ACTIVE_RUN_STATUSES) {
      expect(isActiveRunStatus(status)).toBe(true);
      expect(isTerminalRunStatus(status)).toBe(false);
    }
  });

  it("classifies an unknown status as neither", () => {
    expect(isTerminalRunStatus("wound_down")).toBe(false);
    expect(isActiveRunStatus("wound_down")).toBe(false);
  });

  it("caps the streak walk at 100 runs", () => {
    expect(MAX_RUNS_FOR_STREAK).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run src/__tests__/run-signals-scope.test.ts`
Expected: FAIL — cannot resolve `../services/run-signals/scope.ts`.

- [ ] **Step 3: Write the implementation**

Create `server/src/services/run-signals/scope.ts`. The three-key `or` is copied verbatim from `productivity-review.ts:113-120` — do not "tidy" it to a single key.

```ts
/**
 * FILE: server/src/services/run-signals/scope.ts
 * ABOUT: Run<->issue attribution predicate and run status sets, shared by Health Sentinel detectors.
 *
 * SECTIONS:
 *   [TAG: module] - scope.ts (run-signals module).
 */
// ==========================================
// [META: module]
// INTENT: Single owned definition of "which runs belong to this issue".
// PSEUDOCODE: 1. Load dependencies. 2. Define predicate + status sets. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/run-signals/scope.ts", "imports": "drizzle-orm, @paperclipai/db", "exports": "issueRunScopeSql, status sets"}
// ==========================================
// [START: module]
import { sql } from "drizzle-orm";
import { heartbeatRuns } from "@paperclipai/db";

export const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "cancelled", "timed_out"] as const;
export const ACTIVE_RUN_STATUSES = ["queued", "running", "scheduled_retry"] as const;

/**
 * Bounds the newest-first walk used for the no-comment streak. Not an
 * incidental page size: the streak is only meaningful over a bounded window.
 */
export const MAX_RUNS_FOR_STREAK = 100;

export function isTerminalRunStatus(status: string): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

export function isActiveRunStatus(status: string): boolean {
  return (ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
}

/**
 * Run -> issue attribution was never normalised onto a column, so three
 * contextSnapshot key variants are in use across adapters and the recovery
 * paths. All three must be matched; dropping one silently under-counts a
 * detector's evidence. This is the single definition — do not inline it.
 */
export function issueRunScopeSql(issueId: string) {
  return sql`(
    ${heartbeatRuns.contextSnapshot}->>'issueId' = ${issueId}
    or ${heartbeatRuns.contextSnapshot}->>'taskId' = ${issueId}
    or ${heartbeatRuns.contextSnapshot}->>'taskKey' = ${issueId}
  )`;
}
// [END: module]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm exec vitest run src/__tests__/run-signals-scope.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/run-signals/scope.ts server/src/__tests__/run-signals-scope.test.ts
git commit -m "feat(combo-03): run-signals scope predicate and run status sets"
```

---

### Task 2: Declare the shared types

**Files:**
- Create: `packages/shared/src/types/run-signals.ts`
- Modify: `packages/shared/src/types/index.ts` (append re-export)

**Interfaces:**
- Consumes: nothing.
- Produces: `IssueRunSignalScope`, `IssueRunSignals`, importable both as `@paperclipai/shared` and `@paperclipai/shared/types/run-signals`.

- [ ] **Step 1: Write the type module**

No test — these are types with no runtime behaviour; Task 3 exercises them. Create `packages/shared/src/types/run-signals.ts`:

```ts
/**
 * FILE: packages/shared/src/types/run-signals.ts
 * ABOUT: Wire/domain types for the Combo-03 run-signal read model.
 *
 * SECTIONS:
 *   [TAG: module] - run-signals.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: Shared shapes for per-issue run signals consumed by Health Sentinel detectors.
// PSEUDOCODE: 1. Define scope. 2. Define signals. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/run-signals.ts", "imports": "none", "exports": "IssueRunSignalScope, IssueRunSignals"}
// ==========================================
// [START: module]

/**
 * Scope is an (issue, agent) pair, not an issue alone: the detectors ask
 * "what has *this agent* been doing on *this issue*". Widening to all agents
 * changes which issues trip a detector.
 */
export interface IssueRunSignalScope {
  issueId: string;
  agentId: string;
}

export interface IssueRunSignals {
  issueId: string;
  agentId: string;
  /** Newest-first, capped at MAX_RUNS_FOR_STREAK. */
  runIds: string[];
  terminalRunCount: number;
  activeRunCount: number;
  runCountLastHour: number;
  runCountLastSixHours: number;
  /** Comments by this agent, from runs attributed to this issue. */
  commentCount: number;
  commentCountLastHour: number;
  commentCountLastSixHours: number;
  /** Consecutive newest terminal runs that produced no issue comment. */
  noCommentStreak: number;
  /** Per-issue, NOT agent-scoped. */
  costCents: number;
}
// [END: module]
```

- [ ] **Step 2: Re-export from the barrel**

Append to `packages/shared/src/types/index.ts`, immediately before the closing `// [END: module]` line:

```ts
export type {
  IssueRunSignalScope,
  IssueRunSignals,
} from "./run-signals.js";
```

- [ ] **Step 3: Verify it typechecks and resolves**

Run: `pnpm exec tsc -b packages/shared`
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/run-signals.ts packages/shared/src/types/index.ts
git commit -m "feat(combo-03): shared types for the run-signal read model"
```

---

### Task 3: Batched per-issue aggregation

The core of the phase. Each aggregate is **one grouped query over the whole scope array** — never one query per issue. Phase 2's heatmap loads a whole company at once, so an N+1 shape here would have to be rewritten later.

**Files:**
- Create: `server/src/services/run-signals/issue-signals.ts`
- Test: `server/src/__tests__/run-signals-issue-signals.test.ts`

**Interfaces:**
- Consumes: `issueRunScopeSql`, `isTerminalRunStatus`, `isActiveRunStatus`, `MAX_RUNS_FOR_STREAK` (Task 1); `IssueRunSignalScope`, `IssueRunSignals` (Task 2).
- Produces: `getIssueRunSignals(db: Db, companyId: string, scopes: IssueRunSignalScope[], now: Date): Promise<Map<string, IssueRunSignals>>` — keyed by `issueId`. Scopes with no matching runs are **omitted** from the Map.

- [ ] **Step 1: Write the failing tests**

Create `server/src/__tests__/run-signals-issue-signals.test.ts`. Follow the embedded-postgres harness in `productivity-review-service.test.ts:41-62` exactly.

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issueComments, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { getIssueRunSignals } from "../services/run-signals/issue-signals.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres run-signals tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("getIssueRunSignals", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  const now = new Date("2026-07-31T12:00:00.000Z");

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-run-signals-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql.raw(`TRUNCATE TABLE "companies" CASCADE`));
  });

  afterAll(async () => {
    await tempDb?.stop();
  });

  async function seedCompanyAgentIssue() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Acme", slug: `acme-${companyId.slice(0, 8)}` });
    await db.insert(agents).values({
      id: agentId, companyId, name: "Coder", urlKey: `coder-${agentId.slice(0, 8)}`,
      role: "worker", adapterType: "process", status: "active",
    });
    await db.insert(issues).values({
      id: issueId, companyId, title: "Ship it", status: "in_progress",
      identifier: `ACME-${issueId.slice(0, 4)}`, assigneeAgentId: agentId,
    });
    return { companyId, agentId, issueId };
  }

  async function insertRun(input: {
    companyId: string; agentId: string; status: string;
    contextKey: "issueId" | "taskId" | "taskKey"; issueId: string; startedAt: Date;
  }) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId, companyId: input.companyId, agentId: input.agentId, status: input.status,
      startedAt: input.startedAt, createdAt: input.startedAt,
      contextSnapshot: { [input.contextKey]: input.issueId },
    });
    return runId;
  }

  it.each(["issueId", "taskId", "taskKey"] as const)(
    "attributes a run to its issue via the %s context key",
    async (contextKey) => {
      const { companyId, agentId, issueId } = await seedCompanyAgentIssue();
      await insertRun({ companyId, agentId, status: "succeeded", contextKey, issueId, startedAt: now });

      const signals = await getIssueRunSignals(db, companyId, [{ issueId, agentId }], now);

      expect(signals.get(issueId)?.terminalRunCount).toBe(1);
    },
  );

  it("separates terminal from active runs", async () => {
    const { companyId, agentId, issueId } = await seedCompanyAgentIssue();
    await insertRun({ companyId, agentId, status: "succeeded", contextKey: "issueId", issueId, startedAt: now });
    await insertRun({ companyId, agentId, status: "failed", contextKey: "issueId", issueId, startedAt: now });
    await insertRun({ companyId, agentId, status: "running", contextKey: "issueId", issueId, startedAt: now });

    const signals = await getIssueRunSignals(db, companyId, [{ issueId, agentId }], now);

    expect(signals.get(issueId)?.terminalRunCount).toBe(2);
    expect(signals.get(issueId)?.activeRunCount).toBe(1);
  });

  it("counts runs inside the 1h and 6h windows only", async () => {
    const { companyId, agentId, issueId } = await seedCompanyAgentIssue();
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    await insertRun({ companyId, agentId, status: "succeeded", contextKey: "issueId", issueId, startedAt: minutesAgo(30) });
    await insertRun({ companyId, agentId, status: "succeeded", contextKey: "issueId", issueId, startedAt: minutesAgo(180) });
    await insertRun({ companyId, agentId, status: "succeeded", contextKey: "issueId", issueId, startedAt: minutesAgo(600) });

    const signals = await getIssueRunSignals(db, companyId, [{ issueId, agentId }], now);

    expect(signals.get(issueId)?.runCountLastHour).toBe(1);
    expect(signals.get(issueId)?.runCountLastSixHours).toBe(2);
  });

  it("stops the no-comment streak at the newest run that produced a comment", async () => {
    const { companyId, agentId, issueId } = await seedCompanyAgentIssue();
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    // Newest first: two silent runs, then one that commented.
    await insertRun({ companyId, agentId, status: "succeeded", contextKey: "issueId", issueId, startedAt: minutesAgo(10) });
    await insertRun({ companyId, agentId, status: "succeeded", contextKey: "issueId", issueId, startedAt: minutesAgo(20) });
    const commentingRunId = await insertRun({
      companyId, agentId, status: "succeeded", contextKey: "issueId", issueId, startedAt: minutesAgo(30),
    });
    await db.insert(issueComments).values({
      id: randomUUID(), companyId, issueId, authorAgentId: agentId,
      createdByRunId: commentingRunId, body: "progress", createdAt: minutesAgo(30),
    });

    const signals = await getIssueRunSignals(db, companyId, [{ issueId, agentId }], now);

    expect(signals.get(issueId)?.noCommentStreak).toBe(2);
  });

  it("returns one entry per scope in a single batch", async () => {
    const first = await seedCompanyAgentIssue();
    const secondIssueId = randomUUID();
    await db.insert(issues).values({
      id: secondIssueId, companyId: first.companyId, title: "Second", status: "in_progress",
      identifier: `ACME-${secondIssueId.slice(0, 4)}`, assigneeAgentId: first.agentId,
    });
    await insertRun({ ...first, status: "succeeded", contextKey: "issueId", startedAt: now });
    await insertRun({
      companyId: first.companyId, agentId: first.agentId, status: "failed",
      contextKey: "issueId", issueId: secondIssueId, startedAt: now,
    });

    const signals = await getIssueRunSignals(
      db, first.companyId,
      [{ issueId: first.issueId, agentId: first.agentId }, { issueId: secondIssueId, agentId: first.agentId }],
      now,
    );

    expect(signals.size).toBe(2);
    expect(signals.get(first.issueId)?.terminalRunCount).toBe(1);
    expect(signals.get(secondIssueId)?.terminalRunCount).toBe(1);
  });

  it("omits scopes with no matching runs rather than throwing", async () => {
    const { companyId, agentId } = await seedCompanyAgentIssue();

    const signals = await getIssueRunSignals(db, companyId, [{ issueId: randomUUID(), agentId }], now);

    expect(signals.size).toBe(0);
  });

  it("does not leak runs across companies", async () => {
    const mine = await seedCompanyAgentIssue();
    const theirs = await seedCompanyAgentIssue();
    await insertRun({
      companyId: theirs.companyId, agentId: theirs.agentId, status: "succeeded",
      contextKey: "issueId", issueId: mine.issueId, startedAt: now,
    });

    const signals = await getIssueRunSignals(db, mine.companyId, [{ issueId: mine.issueId, agentId: mine.agentId }], now);

    expect(signals.size).toBe(0);
  });

  it("short-circuits on empty input without querying", async () => {
    const signals = await getIssueRunSignals(db, randomUUID(), [], now);
    expect(signals.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && pnpm exec vitest run src/__tests__/run-signals-issue-signals.test.ts`
Expected: FAIL — cannot resolve `../services/run-signals/issue-signals.ts`.

- [ ] **Step 3: Write the implementation**

Create `server/src/services/run-signals/issue-signals.ts`. Note the window predicate uses `coalesce(startedAt, createdAt)` — matching `productivity-review.ts:372`, because a queued run has no `startedAt` and must still count.

```ts
/**
 * FILE: server/src/services/run-signals/issue-signals.ts
 * ABOUT: Batched per-issue run aggregates for Combo-03 Health Sentinel detectors.
 *
 * SECTIONS:
 *   [TAG: module] - issue-signals.ts (run-signals module).
 */
// ==========================================
// [META: module]
// INTENT: Answer "what has this agent been doing on this issue" for many issues at once.
// PSEUDOCODE: 1. Load runs per scope. 2. Aggregate counts/windows. 3. Walk streak. 4. Attach cost.
// JSON_FLOW: {"file": "server/src/services/run-signals/issue-signals.ts", "imports": "drizzle-orm, @paperclipai/db", "exports": "getIssueRunSignals"}
// ==========================================
// [START: module]
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { costEvents, heartbeatRuns, issueComments } from "@paperclipai/db";
import type { IssueRunSignalScope, IssueRunSignals } from "@paperclipai/shared";
import {
  isActiveRunStatus,
  isTerminalRunStatus,
  issueRunScopeSql,
  MAX_RUNS_FOR_STREAK,
} from "./scope.js";

type RunRow = {
  id: string;
  agentId: string;
  status: string;
  effectiveAt: Date;
  issueId: string;
};

export async function getIssueRunSignals(
  db: Db,
  companyId: string,
  scopes: IssueRunSignalScope[],
  now: Date,
): Promise<Map<string, IssueRunSignals>> {
  const result = new Map<string, IssueRunSignals>();
  if (scopes.length === 0) return result;

  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

  // One predicate covering every (issue, agent) pair, so the whole batch is a
  // single scan rather than one query per issue.
  const scopePredicate = or(
    ...scopes.map((scope) =>
      and(eq(heartbeatRuns.agentId, scope.agentId), issueRunScopeSql(scope.issueId)),
    ),
  );

  // `issueId` is projected back out of contextSnapshot so rows can be bucketed
  // without re-testing every scope in JS.
  const issueIdExpr = sql<string>`coalesce(
    ${heartbeatRuns.contextSnapshot}->>'issueId',
    ${heartbeatRuns.contextSnapshot}->>'taskId',
    ${heartbeatRuns.contextSnapshot}->>'taskKey'
  )`;

  const runRows = (await db
    .select({
      id: heartbeatRuns.id,
      agentId: heartbeatRuns.agentId,
      status: heartbeatRuns.status,
      effectiveAt: sql<Date>`coalesce(${heartbeatRuns.startedAt}, ${heartbeatRuns.createdAt})`,
      issueId: issueIdExpr,
    })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, companyId), scopePredicate))
    .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id))) as RunRow[];

  const runsByIssue = new Map<string, RunRow[]>();
  for (const row of runRows) {
    if (!row.issueId) continue;
    const bucket = runsByIssue.get(row.issueId);
    // Newest-first from the ORDER BY; the cap bounds the streak walk.
    if (bucket) {
      if (bucket.length < MAX_RUNS_FOR_STREAK) bucket.push(row);
    } else {
      runsByIssue.set(row.issueId, [row]);
    }
  }

  const allRunIds = runRows.map((row) => row.id);
  const commentingRunIds = new Set<string>();
  const commentRows = allRunIds.length
    ? await db
        .select({
          issueId: issueComments.issueId,
          createdByRunId: issueComments.createdByRunId,
          authorAgentId: issueComments.authorAgentId,
          createdAt: issueComments.createdAt,
        })
        .from(issueComments)
        .where(
          and(
            eq(issueComments.companyId, companyId),
            inArray(issueComments.createdByRunId, allRunIds),
          ),
        )
    : [];
  for (const row of commentRows) {
    if (row.createdByRunId) commentingRunIds.add(row.createdByRunId);
  }

  const issueIds = [...runsByIssue.keys()];
  const costRows = issueIds.length
    ? await db
        .select({
          issueId: costEvents.issueId,
          costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
        })
        .from(costEvents)
        .where(and(eq(costEvents.companyId, companyId), inArray(costEvents.issueId, issueIds)))
        .groupBy(costEvents.issueId)
    : [];
  const costByIssue = new Map(costRows.map((row) => [row.issueId as string, row.costCents]));

  for (const scope of scopes) {
    const runs = runsByIssue.get(scope.issueId);
    if (!runs || runs.length === 0) continue;

    let noCommentStreak = 0;
    for (const run of runs) {
      if (!isTerminalRunStatus(run.status)) continue;
      if (commentingRunIds.has(run.id)) break;
      noCommentStreak += 1;
    }

    const issueComments_ = commentRows.filter((row) => row.issueId === scope.issueId
      && row.authorAgentId === scope.agentId);
    const within = (since: Date) => (at: Date | null) => at !== null && new Date(at) >= since;

    result.set(scope.issueId, {
      issueId: scope.issueId,
      agentId: scope.agentId,
      runIds: runs.map((run) => run.id),
      terminalRunCount: runs.filter((run) => isTerminalRunStatus(run.status)).length,
      activeRunCount: runs.filter((run) => isActiveRunStatus(run.status)).length,
      runCountLastHour: runs.filter((run) => new Date(run.effectiveAt) >= oneHourAgo).length,
      runCountLastSixHours: runs.filter((run) => new Date(run.effectiveAt) >= sixHoursAgo).length,
      commentCount: issueComments_.length,
      commentCountLastHour: issueComments_.filter((row) => within(oneHourAgo)(row.createdAt)).length,
      commentCountLastSixHours: issueComments_.filter((row) => within(sixHoursAgo)(row.createdAt)).length,
      noCommentStreak,
      costCents: costByIssue.get(scope.issueId) ?? 0,
    });
  }

  return result;
}
// [END: module]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && pnpm exec vitest run src/__tests__/run-signals-issue-signals.test.ts`
Expected: PASS (10 tests — the `it.each` expands to 3).

If the host cannot run embedded-postgres the suite skips with a warning; that is the repo's accepted behaviour, but you must get a real PASS locally before committing.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/run-signals/issue-signals.ts server/src/__tests__/run-signals-issue-signals.test.ts
git commit -m "feat(combo-03): batched per-issue run signal aggregation"
```

---

### Task 4: Facade

**Files:**
- Create: `server/src/services/run-signals/index.ts`
- Modify: `server/src/services/index.ts` (append export)

**Interfaces:**
- Consumes: `getIssueRunSignals` (Task 3).
- Produces: `runSignalsService(db: Db)` → `{ issueSignals(companyId, scopes, now) }`.

- [ ] **Step 1: Write the facade**

No separate test — Task 5 exercises it through the real consumer, which is a stronger check than a mock-based unit test would be.

Create `server/src/services/run-signals/index.ts`:

```ts
/**
 * FILE: server/src/services/run-signals/index.ts
 * ABOUT: Facade for the Combo-03 run-signal read model.
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (run-signals module).
 */
// ==========================================
// [META: module]
// INTENT: Bind the read model to a Db handle, matching the repo's xService(db) pattern.
// PSEUDOCODE: 1. Accept Db. 2. Return bound readers.
// JSON_FLOW: {"file": "server/src/services/run-signals/index.ts", "imports": "./issue-signals.js", "exports": "runSignalsService"}
// ==========================================
// [START: module]
import type { Db } from "@paperclipai/db";
import type { IssueRunSignalScope } from "@paperclipai/shared";
import { getIssueRunSignals } from "./issue-signals.js";

export { getIssueRunSignals } from "./issue-signals.js";
export {
  ACTIVE_RUN_STATUSES,
  isActiveRunStatus,
  isTerminalRunStatus,
  issueRunScopeSql,
  MAX_RUNS_FOR_STREAK,
  TERMINAL_RUN_STATUSES,
} from "./scope.js";

export function runSignalsService(db: Db) {
  return {
    issueSignals(companyId: string, scopes: IssueRunSignalScope[], now: Date) {
      return getIssueRunSignals(db, companyId, scopes, now);
    },
  };
}
// [END: module]
```

- [ ] **Step 2: Export from the services barrel**

Append to `server/src/services/index.ts`, before its closing `// [END: module]`:

```ts
export { runSignalsService } from "./run-signals/index.js";
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm exec tsc -b server`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/run-signals/index.ts server/src/services/index.ts
git commit -m "feat(combo-03): run-signals service facade"
```

---

### Task 5: Port productivity-review onto the read model

The proof. **`server/src/__tests__/productivity-review-service.test.ts` must pass unmodified.**

**Files:**
- Modify: `server/src/services/productivity-review.ts` — delete `issueRunScopeSql` (lines 113-120), `countIssueRunsSince` (363-376), `countIssueCommentsSince` (378-395), and the run/comment/cost gathering inside `collectEvidence` (406-482). Keep `TERMINAL_RUN_STATUSES` / `ACTIVE_RUN_STATUSES` / `MAX_RUNS_FOR_STREAK` usage but import them.
- Test: `server/src/__tests__/productivity-review-service.test.ts` — **read only, do not edit**.

**Interfaces:**
- Consumes: `runSignalsService` / `getIssueRunSignals` (Tasks 3-4), scope constants (Task 1).
- Produces: no API change. `productivityReviewService(db, deps)` keeps its exact signature.

- [ ] **Step 1: Run the existing tests to capture the green baseline**

Run: `cd server && pnpm exec vitest run src/__tests__/productivity-review-service.test.ts`
Expected: PASS (11 tests). Record the count. If this is not green *before* you change anything, stop — you are debugging a pre-existing failure, not your refactor.

- [ ] **Step 2: Replace the local definitions with imports**

In `server/src/services/productivity-review.ts`, delete the local `TERMINAL_RUN_STATUSES`, `ACTIVE_RUN_STATUSES`, `MAX_RUNS_FOR_STREAK` (lines 48-51, keeping `MAX_CANDIDATE_ISSUES` and `MAX_PARENT_WALK_DEPTH`) and the `issueRunScopeSql` function, then add:

```ts
import { getIssueRunSignals } from "./run-signals/index.js";
import {
  ACTIVE_RUN_STATUSES,
  isTerminalRunStatus,
  MAX_RUNS_FOR_STREAK,
  TERMINAL_RUN_STATUSES,
} from "./run-signals/scope.js";
```

- [ ] **Step 3: Rewrite the gathering half of `collectEvidence`**

Replace the block from `const latestRuns = await db` through the `Promise.all([...])` destructuring with a single call. Everything after — `activeRunCount`, `elapsedMs`, threshold comparison, `choosePrimaryTrigger`, `triggerReasons` — stays exactly as it is.

```ts
    const signalsByIssue = await getIssueRunSignals(
      db,
      sourceIssue.companyId,
      [{ issueId: sourceIssue.id, agentId: sourceAgent.id }],
      now,
    );
    const signals = signalsByIssue.get(sourceIssue.id);
    if (!signals) return null;

    const noCommentStreak = signals.noCommentStreak;
    const runCountLastHour = signals.runCountLastHour;
    const runCountLastSixHours = signals.runCountLastSixHours;
    const assigneeRunCommentCount = signals.commentCount;
    const assigneeRunCommentCountLastHour = signals.commentCountLastHour;
    const assigneeRunCommentCountLastSixHours = signals.commentCountLastSixHours;
    const activeRunCount = signals.activeRunCount;
    const costRow = { costCents: signals.costCents };
```

`latestRuns` and `latestComments` are still needed for evidence *formatting* (`runUiLink`, comment excerpts). Fetch them separately, right here, since they are presentation concerns rather than signals:

```ts
    const latestRuns = signals.runIds.length
      ? await db.select().from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, sourceIssue.companyId),
                     inArray(heartbeatRuns.id, signals.runIds)))
          .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id))
      : [];

    const latestComments = await db
      .select({ comment: issueComments })
      .from(issueComments)
      .where(and(
        eq(issueComments.companyId, sourceIssue.companyId),
        eq(issueComments.issueId, sourceIssue.id),
        eq(issueComments.authorAgentId, sourceAgent.id),
        signals.runIds.length ? inArray(issueComments.createdByRunId, signals.runIds) : sql`false`,
      ))
      .orderBy(desc(issueComments.createdAt), desc(issueComments.id))
      .limit(5)
      .then((rows) => rows.map((row) => row.comment));
```

- [ ] **Step 4: Run the existing tests — they must pass unmodified**

Run: `cd server && pnpm exec vitest run src/__tests__/productivity-review-service.test.ts`
Expected: PASS, same 11 tests, zero edits to the test file.

If any fail: the refactor changed behaviour. Diff your aggregation against the original semantics in the spec's `IssueRunSignals` table — most likely causes are (a) dropping the `coalesce(startedAt, createdAt)` window, (b) counting all issue comments instead of only this agent's run-created ones, or (c) losing the newest-first order the streak walk depends on. **Do not edit the test to make it pass.**

- [ ] **Step 5: Run the full server suite for regressions**

Run: `cd server && pnpm exec vitest run`
Expected: no new failures versus `master`. `ArtifactCard` is a known-flaky UI test — ignore it if it fails.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/productivity-review.ts
git commit -m "refactor(combo-03): port productivity-review onto the run-signal read model"
```

---

### Task 6: Record completion

**Files:**
- Modify: `docs/superpowers/BUILD-DECISIONS.md`

- [ ] **Step 1: Update the status table and log the outcome**

Change the Combo 03 row's status to `Phase 1 complete` and append a `## [YYYY-MM-DD] Completed — Combo 03 Phase 1` entry using the template at the bottom of the file, listing which exit criteria were met.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/BUILD-DECISIONS.md
git commit -m "docs(combo-03): record phase 1 completion"
```

---

## Self-Review

**Spec coverage:**
- "single owned join predicate" → Task 1
- shared types / dual barrel → Task 2
- batched `Map`-returning aggregation, omit-on-miss, company scoping, null-timestamp handling, empty-input short circuit → Task 3 (tests + impl)
- `runSignalsService(db)` facade → Task 4
- productivity-review port with 11 tests green unmodified → Task 5
- "no new tables / migration / dependency / route / UI" → Global Constraints; no task adds any
- `AgentRunSignals` → explicitly deferred in the spec; correctly has no task
- `elapsedMs` stays in productivity-review → Task 5 Step 3 leaves that code untouched

**Placeholder scan:** no TBD/TODO; every code step has real code; no "similar to Task N".

**Type consistency:** `IssueRunSignalScope` / `IssueRunSignals` declared in Task 2 and used with identical field names in Tasks 3-5. `getIssueRunSignals(db, companyId, scopes, now)` has the same four-argument signature in Tasks 3, 4 and 5. Scope constants exported from `scope.ts` in Task 1 are imported under those exact names in Tasks 3 and 5.

**Known risk carried into execution:** Task 3's `commentCount` filters `commentRows` in JS, which were fetched by `createdByRunId` across the whole batch. For a single scope this matches the original inner-join semantics. Task 5 Step 4 is what verifies that — if the 11 tests disagree, trust them over this plan.
