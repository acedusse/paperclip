# Claim-Aware Run Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an instance opt-in is on, stop the run scheduler from starting *new work* in a shared workspace another active run is already editing (holds a live path claim), leaving that run queued and audited — while continuations always proceed and a run held past a bound is admitted with a distinct audit.

**Architecture:** A pure decision helper (`decideClaimScheduling`) classifies each queued new-start run as `admit | defer | admit_despite_claim` from claim-count + queued-age inputs. A batched claim-count query feeds it once per sweep. The decision is wired into the existing `claimUpTo` loop in `heartbeat.ts` (the same seam WIP enforcement uses), gated by a new instance setting, defaulting off.

**Tech Stack:** TypeScript, Drizzle ORM, Zod (shared validators), Vitest (+ embedded Postgres for service/integration tests), pnpm workspaces.

## Global Constraints

- **Workspace grain only.** A queued run's subtree is unknown at selection time; reason only over `issues.executionWorkspaceId`. Never assume a path.
- **New starts only.** The gate applies when `isNewStartIssueStatus(issue.status)` is true. Continuations always proceed.
- **Off by default.** `workspaceClaimAwareScheduling` defaults `false`; when false, scheduling is byte-identical to today (no query, no per-run work).
- **Never throw into selection.** Any config/query/audit failure is logged (`logger.warn`) and admits without the gate this sweep — mirror wip-flow's `wipBudget = Infinity` fallback.
- **Compose with WIP, don't replace it.** The claim gate is evaluated before the existing WIP new-start check. `defer` leaves the run queued without consuming WIP budget; `admit`/`admit_despite_claim` fall through to the unchanged WIP logic. The bounded-admit overrides the *claim* gate only, never WIP.
- **Bound = claim TTL.** Use `DEFAULT_CLAIM_TTL_MS` (from `workspace-path-claims.ts`, `1_800_000`) as `boundMs`.
- **Audit shape:** `actorType: "system"`, `actorId: "workspace-conflict-scheduling"`, `entityType: "issue"`, `details: { executionWorkspaceId, contendingClaimCount, queuedForMs, boundMs }`. Actions: `issue.start_deferred_path_claim`, `issue.start_admitted_despite_path_claim`.
- Run tests: `cd server && npx vitest run <path>` (server), `cd packages/shared && npx vitest run <path>` (shared). Typecheck: `cd server && pnpm typecheck`.

---

## File Structure

- Create `server/src/services/workspace-claim-scheduling.ts` — pure decision (Task 1).
- Create `server/src/services/workspace-claim-scheduling.test.ts` — pure decision tests (Task 1).
- Modify `server/src/services/workspace-path-claims.ts` — add `activeClaimCountsForWorkspaces` (Task 2).
- Modify `server/src/__tests__/workspace-path-claims-service.test.ts` — count-query test (Task 2).
- Modify `packages/shared/src/validators/instance.ts` — schema field (Task 3).
- Modify `packages/shared/src/types/instance.ts` — type field (Task 3).
- Modify `server/src/services/instance-settings.ts` — carry field through `normalizeGeneralSettings` (Task 3).
- Create `packages/shared/src/validators/instance.test.ts` — schema default test (Task 3).
- Modify `server/src/services/heartbeat.ts` — issue select + audit helper + config resolve + loop decision (Task 4).
- Create `server/src/__tests__/heartbeat-claim-aware-selection-tick.test.ts` — integration proof (Task 4).

---

### Task 1: Pure decision helper

**Files:**
- Create: `server/src/services/workspace-claim-scheduling.ts`
- Test: `server/src/services/workspace-claim-scheduling.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ClaimSchedulingDecision = "admit" | "defer" | "admit_despite_claim"` and `decideClaimScheduling(input: { enabled: boolean; isNewStart: boolean; activeClaimCount: number; queuedForMs: number; boundMs: number }): ClaimSchedulingDecision`.

- [ ] **Step 1: Write the failing test**

Create `server/src/services/workspace-claim-scheduling.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideClaimScheduling } from "./workspace-claim-scheduling.ts";

const base = { enabled: true, isNewStart: true, activeClaimCount: 1, queuedForMs: 0, boundMs: 1000 };

describe("decideClaimScheduling", () => {
  it("admits when disabled even with contention", () => {
    expect(decideClaimScheduling({ ...base, enabled: false })).toBe("admit");
  });
  it("admits a continuation even with contention", () => {
    expect(decideClaimScheduling({ ...base, isNewStart: false })).toBe("admit");
  });
  it("admits a new start when there are no active claims", () => {
    expect(decideClaimScheduling({ ...base, activeClaimCount: 0 })).toBe("admit");
  });
  it("defers a new start under contention within the bound", () => {
    expect(decideClaimScheduling({ ...base, queuedForMs: 500 })).toBe("defer");
  });
  it("defers exactly at the bound (boundary is inclusive of defer)", () => {
    expect(decideClaimScheduling({ ...base, queuedForMs: 1000 })).toBe("defer");
  });
  it("admits despite contention once queued past the bound", () => {
    expect(decideClaimScheduling({ ...base, queuedForMs: 1001 })).toBe("admit_despite_claim");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/workspace-claim-scheduling.test.ts`
Expected: FAIL — cannot find module `./workspace-claim-scheduling.ts` / `decideClaimScheduling is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/services/workspace-claim-scheduling.ts`:

```ts
export type ClaimSchedulingDecision = "admit" | "defer" | "admit_despite_claim";

/**
 * Workspace-grain claim-aware selection decision (Combo 01, Phase 4B slice 3).
 * A queued run's subtree is unknown at selection time, so we reason only over
 * whether the run's shared workspace has any live claim from another run.
 * Applies to NEW STARTS only; continuations always admit. A new start held
 * longer than `boundMs` is admitted anyway (bounded-defer, no starvation).
 */
export function decideClaimScheduling(input: {
  enabled: boolean;
  isNewStart: boolean;
  activeClaimCount: number;
  queuedForMs: number;
  boundMs: number;
}): ClaimSchedulingDecision {
  if (!input.enabled) return "admit";
  if (!input.isNewStart) return "admit";
  if (input.activeClaimCount <= 0) return "admit";
  if (input.queuedForMs > input.boundMs) return "admit_despite_claim";
  return "defer";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/services/workspace-claim-scheduling.test.ts`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/workspace-claim-scheduling.ts server/src/services/workspace-claim-scheduling.test.ts
git commit -m "feat(workspace): pure claim-aware selection decision (4B slice 3)"
```

---

### Task 2: Batched active-claim-count query

**Files:**
- Modify: `server/src/services/workspace-path-claims.ts` (imports line 18; add method inside the object returned by `workspacePathClaimService`)
- Test: `server/src/__tests__/workspace-path-claims-service.test.ts`

**Interfaces:**
- Consumes: the existing `workspacePathClaimService(db)` and `workspacePathClaims` table.
- Produces: `workspacePathClaimService(db).activeClaimCountsForWorkspaces(executionWorkspaceIds: string[], now: Date): Promise<Map<string, number>>` — counts `status = "active" AND expiresAt > now` grouped by `executionWorkspaceId`; empty input → empty map, no query.

- [ ] **Step 1: Write the failing test**

Append this test inside the `describeEmbeddedPostgres("workspacePathClaimService", ...)` block in `server/src/__tests__/workspace-path-claims-service.test.ts` (after the last `it(...)`, before the closing `});`). It reuses the file's existing `seed()` helper:

```ts
  it("counts active-within-TTL claims per workspace, excluding released/expired/other", async () => {
    const { companyId, agentId, wsA, runA, runB } = await seed();
    const now = new Date("2026-07-13T00:00:00.000Z");
    const future = { ttlMs: 60_000, now }; // expiresAt = now + 60s
    // Two active claims on wsA from two different runs.
    await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runA, agentId, path: "src/pay", ...future });
    await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runB, agentId, path: "src/ui", ...future });
    // A released claim must not count.
    const released = await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runA, agentId, path: "src/old", ...future });
    await svc.releaseClaimsForRun(runA); // flips runA's active claims → released
    // A claim whose TTL already lapsed relative to `now` must not count.
    await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runB, agentId, path: "src/stale", ttlMs: 1, now: new Date(now.getTime() - 10_000) });

    const counts = await svc.activeClaimCountsForWorkspaces([wsA], now);
    // runA's two claims (src/pay, src/old) were released; only runB's src/ui remains active-within-TTL.
    expect(counts.get(wsA)).toBe(1);
    expect(released.status).toBe("active"); // acquire returns active before release
  });

  it("returns an empty map without a query for empty input", async () => {
    const counts = await svc.activeClaimCountsForWorkspaces([], new Date());
    expect(counts.size).toBe(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/workspace-path-claims-service.test.ts -t "counts active-within-TTL"`
Expected: FAIL — `svc.activeClaimCountsForWorkspaces is not a function`.

- [ ] **Step 3: Extend imports**

In `server/src/services/workspace-path-claims.ts`, change the drizzle import (currently line 18):

```ts
import { and, eq, isNotNull, lte, ne } from "drizzle-orm";
```

to:

```ts
import { and, eq, gt, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
```

- [ ] **Step 4: Add the method**

In `server/src/services/workspace-path-claims.ts`, inside the object returned by `workspacePathClaimService(db)`, add this method immediately after `listActiveClaimsOnWorkspace` (which ends around line 91):

```ts
    async activeClaimCountsForWorkspaces(
      executionWorkspaceIds: string[],
      now: Date,
    ): Promise<Map<string, number>> {
      const counts = new Map<string, number>();
      if (executionWorkspaceIds.length === 0) return counts;
      const rows = await db
        .select({
          executionWorkspaceId: workspacePathClaims.executionWorkspaceId,
          count: sql<number>`count(*)::int`,
        })
        .from(workspacePathClaims)
        .where(
          and(
            inArray(workspacePathClaims.executionWorkspaceId, executionWorkspaceIds),
            eq(workspacePathClaims.status, "active"),
            gt(workspacePathClaims.expiresAt, now),
          ),
        )
        .groupBy(workspacePathClaims.executionWorkspaceId);
      for (const row of rows) counts.set(row.executionWorkspaceId, Number(row.count));
      return counts;
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/workspace-path-claims-service.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/workspace-path-claims.ts server/src/__tests__/workspace-path-claims-service.test.ts
git commit -m "feat(workspace): batched active-claim-count query per workspace (4B slice 3)"
```

---

### Task 3: Instance setting `workspaceClaimAwareScheduling`

**Files:**
- Modify: `packages/shared/src/validators/instance.ts` (schema, ~line 57)
- Modify: `packages/shared/src/types/instance.ts` (type, ~line 68)
- Modify: `server/src/services/instance-settings.ts` (`normalizeGeneralSettings`, ~line 53)
- Test: `packages/shared/src/validators/instance.test.ts` (create)

**Interfaces:**
- Consumes: `instanceGeneralSettingsSchema`, `InstanceGeneralSettings`.
- Produces: `InstanceGeneralSettings.workspaceClaimAwareScheduling?: boolean` (default `false`), surfaced by `instanceSettingsService(db).getGeneral()`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/validators/instance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { instanceGeneralSettingsSchema } from "./instance.js";

describe("instanceGeneralSettingsSchema.workspaceClaimAwareScheduling", () => {
  it("defaults to false when absent", () => {
    const parsed = instanceGeneralSettingsSchema.parse({});
    expect(parsed.workspaceClaimAwareScheduling).toBe(false);
  });
  it("carries an explicit true", () => {
    const parsed = instanceGeneralSettingsSchema.parse({ workspaceClaimAwareScheduling: true });
    expect(parsed.workspaceClaimAwareScheduling).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/validators/instance.test.ts`
Expected: FAIL — `parsed.workspaceClaimAwareScheduling` is `undefined`, not `false`.

- [ ] **Step 3: Add the schema field**

In `packages/shared/src/validators/instance.ts`, inside `instanceGeneralSettingsSchema` (the `z.object({ ... })` starting at line 42), add this line immediately after `predictiveBreakerEnabled: z.boolean().optional(),` (line 57):

```ts
  workspaceClaimAwareScheduling: z.boolean().default(false),
```

- [ ] **Step 4: Add the type field**

In `packages/shared/src/types/instance.ts`, inside `interface InstanceGeneralSettings`, add this line immediately after `predictiveBreakerEnabled?: boolean;` (line 68):

```ts
  /**
   * When true, the run scheduler defers starting NEW work into a shared
   * workspace another active run holds a live path claim on (Combo 01, 4B).
   * Absent/false = no claim-aware gating.
   */
  workspaceClaimAwareScheduling?: boolean;
```

- [ ] **Step 5: Carry the field through `normalizeGeneralSettings`**

In `server/src/services/instance-settings.ts`, inside the `parsed.success` return object of `normalizeGeneralSettings` (lines 39–61), add this line immediately after `predictiveBreakerEnabled: parsed.data.predictiveBreakerEnabled ?? false,` (line 53):

```ts
      workspaceClaimAwareScheduling: parsed.data.workspaceClaimAwareScheduling ?? false,
```

(The explicit-pick construction means `getGeneral()` would drop the field without this line.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/validators/instance.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 7: Typecheck the server (confirms the normalize edit compiles)**

Run: `cd server && pnpm typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/validators/instance.ts packages/shared/src/types/instance.ts packages/shared/src/validators/instance.test.ts server/src/services/instance-settings.ts
git commit -m "feat(settings): workspaceClaimAwareScheduling instance flag, default off (4B slice 3)"
```

---

### Task 4: Wire claim-aware gate into `startNextQueuedRunForAgent`

**Files:**
- Modify: `server/src/services/heartbeat.ts` (issue select ~8745; audit helper near `auditWipDeferral` ~7300; config/count resolution before `const claimedRuns` ~8787; decision inside `claimUpTo` ~8791)
- Test: `server/src/__tests__/heartbeat-claim-aware-selection-tick.test.ts` (create)

**Interfaces:**
- Consumes: `decideClaimScheduling` (Task 1), `workspacePathClaimsSvc.activeClaimCountsForWorkspaces` (Task 2), `getGeneral().workspaceClaimAwareScheduling` (Task 3), the existing in-scope `workspacePathClaimsSvc` (heartbeat.ts:3452), `isNewStartIssueStatus`, `readNonEmptyString`, `parseObject`, `logActivity`, `logger`, `DEFAULT_CLAIM_TTL_MS`.
- Produces: no new exported symbol; observable behavior is the deferral/admit audits and left-queued runs, asserted via the synchronous return of `startNextQueuedRunForAgent(agentId)`.

- [ ] **Step 1: Write the failing integration test**

Create `server/src/__tests__/heartbeat-claim-aware-selection-tick.test.ts`. Model the harness (embedded Postgres setup, `heartbeatService(db)`, and the company/agent/project/issue/run seeding helpers) on the existing `server/src/__tests__/heartbeat-wip-enforcement-tick.test.ts` — copy its `beforeAll`/`afterEach`/`afterAll` scaffold and its seed helpers verbatim, then add the scenarios below. The novel parts:

- Seed a `shared_workspace` execution workspace (`executionWorkspaces`: `mode: "shared_workspace"`, `strategyType: "shared"`, `status: "active"`, a `cwd`) and set the queued issue's `executionWorkspaceId` to it.
- Insert an `active` `workspacePathClaims` row for that workspace from a *different* running run (`heartbeatRunId` = a second run id, `status: "active"`, `expiresAt` = now + 10 min, some `path`).
- Enable the flag by writing instance general settings with `workspaceClaimAwareScheduling: true` (use the same instance-settings write the WIP test uses for its config, or `instanceSettingsService(db).updateGeneral({ workspaceClaimAwareScheduling: true })`).

Assertions use the same pattern as the WIP test — the synchronous return of `startNextQueuedRunForAgent` plus an `activityLog` query:

```ts
  it("defers a new start when its shared workspace has a live claim from another run", async () => {
    const { agentId, newStartIssueId, newStartRunId } = await seedContendedNewStart({ flag: true });
    const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
    const ids = claimed.map((r) => r.id);
    expect(ids).not.toContain(newStartRunId);
    expect(await getRunStatus(newStartRunId)).toBe("queued");
    const audits = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.action, "issue.start_deferred_path_claim"), eq(activityLog.entityId, newStartIssueId)));
    expect(audits).toHaveLength(1);
  });

  it("admits a continuation into the same contended workspace", async () => {
    const { agentId, continuationRunId } = await seedContendedContinuation({ flag: true });
    const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
    expect(claimed.map((r) => r.id)).toContain(continuationRunId);
  });

  it("does not gate when the flag is off (byte-identical scheduling)", async () => {
    const { agentId, newStartRunId } = await seedContendedNewStart({ flag: false });
    const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
    expect(claimed.map((r) => r.id)).toContain(newStartRunId);
    const audits = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "issue.start_deferred_path_claim"));
    expect(audits).toHaveLength(0);
  });

  it("admits a new start once queued past the bound, with the despite audit", async () => {
    // createdAt older than DEFAULT_CLAIM_TTL_MS so queuedForMs > boundMs.
    const { agentId, newStartIssueId, newStartRunId } = await seedContendedNewStart({
      flag: true,
      queuedAt: new Date(Date.now() - (DEFAULT_CLAIM_TTL_MS + 60_000)),
    });
    const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
    expect(claimed.map((r) => r.id)).toContain(newStartRunId);
    const audits = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.action, "issue.start_admitted_despite_path_claim"), eq(activityLog.entityId, newStartIssueId)));
    expect(audits).toHaveLength(1);
  });
```

Import `DEFAULT_CLAIM_TTL_MS` from `../services/workspace-path-claims.ts`. Write `seedContendedNewStart`/`seedContendedContinuation` as thin wrappers over the copied WIP seed helpers: create the shared workspace + the sibling active claim, set the queued run's `createdAt` (default now), and (for the continuation case) give the issue an in-progress status so `isNewStartIssueStatus` is false. `getRunStatus`/`activityLog`/`and`/`eq` come from the same imports the WIP test uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/heartbeat-claim-aware-selection-tick.test.ts`
Expected: FAIL — the new start is claimed (no gate yet), so the first test's `expect(ids).not.toContain(newStartRunId)` fails.

- [ ] **Step 3: Add `executionWorkspaceId` to the queued-issue select**

In `server/src/services/heartbeat.ts`, in `startNextQueuedRunForAgent`, find the `issueRows` select that currently reads:

```ts
      const issueRows = await db
        .select({
          id: issues.id,
          status: issues.status,
          priority: issues.priority,
        })
```

Add the workspace column:

```ts
      const issueRows = await db
        .select({
          id: issues.id,
          status: issues.status,
          priority: issues.priority,
          executionWorkspaceId: issues.executionWorkspaceId,
        })
```

- [ ] **Step 4: Add the audit helper**

In `server/src/services/heartbeat.ts`, immediately after the `auditWipDeferral` function (ends ~line 7322), add:

```ts
  async function auditClaimScheduling(
    agent: { id: string; companyId: string },
    runId: string,
    issueId: string,
    action: "issue.start_deferred_path_claim" | "issue.start_admitted_despite_path_claim",
    details: {
      executionWorkspaceId: string;
      contendingClaimCount: number;
      queuedForMs: number;
      boundMs: number;
    },
  ) {
    try {
      await logActivity(db, {
        companyId: agent.companyId,
        actorType: "system",
        actorId: "workspace-conflict-scheduling",
        agentId: agent.id,
        runId,
        action,
        entityType: "issue",
        entityId: issueId,
        details,
      });
    } catch (err) {
      logger.warn({ err, issueId, runId }, "claim-scheduling audit failed; continuing admission");
    }
  }
```

- [ ] **Step 5: Add the import for the bound and the decision helper**

In `server/src/services/heartbeat.ts`, near the existing wip-flow import (line 126, `import { parseWipLimitConfig, isNewStartIssueStatus, newStartBudget } from "./wip-flow.js";`), add:

```ts
import { decideClaimScheduling } from "./workspace-claim-scheduling.js";
import { DEFAULT_CLAIM_TTL_MS } from "./workspace-path-claims.js";
```

(The `workspace-path-claims.js` module is already imported for `workspacePathClaimService`; add `DEFAULT_CLAIM_TTL_MS` to that existing import instead if you prefer a single import line.)

- [ ] **Step 6: Resolve config + batched counts before the loop**

In `server/src/services/heartbeat.ts`, in `startNextQueuedRunForAgent`, immediately before the line `const claimedRuns: Array<typeof heartbeatRuns.$inferSelect> = [];` (~line 8787), insert:

```ts
      // Claim-aware selection (Combo 01, 4B slice 3). Off by default; on failure
      // admit without the gate this sweep. Resolved once; read inside claimUpTo.
      const claimNow = new Date();
      let claimSchedEnabled = false;
      const claimCounts = new Map<string, number>();
      try {
        claimSchedEnabled =
          (await instanceSettingsService(db).getGeneral()).workspaceClaimAwareScheduling ?? false;
        if (claimSchedEnabled) {
          const newStartWorkspaceIds = [
            ...new Set(
              prioritizedRuns
                .map((run) => {
                  const iid = readNonEmptyString(parseObject(run.contextSnapshot).issueId);
                  const issue = iid ? issueById.get(iid) : undefined;
                  return isNewStartIssueStatus(issue?.status ?? null)
                    ? issue?.executionWorkspaceId ?? null
                    : null;
                })
                .filter((wsId): wsId is string => Boolean(wsId)),
            ),
          ];
          const counts = await workspacePathClaimsSvc.activeClaimCountsForWorkspaces(
            newStartWorkspaceIds,
            claimNow,
          );
          for (const [wsId, count] of counts) claimCounts.set(wsId, count);
        }
      } catch (err) {
        logger.warn({ err }, "claim-aware scheduling resolve failed; admitting without claim gate this sweep");
        claimSchedEnabled = false;
        claimCounts.clear();
      }
```

(`prioritizedRuns` and `issueById` are already defined above this point; `claimUpTo` is defined just below and captures these by reference, executing only after this block runs.)

- [ ] **Step 7: Apply the decision inside `claimUpTo`**

In `server/src/services/heartbeat.ts`, in the `claimUpTo` loop, the current body is:

```ts
        for (const queuedRun of prioritizedRuns) {
          if (claimedRuns.length >= budget) break;
          const issueId = readNonEmptyString(parseObject(queuedRun.contextSnapshot).issueId);
          const isNewStart = isNewStartIssueStatus(issueId ? issueById.get(issueId)?.status : null);
          if (isNewStart && newStartsClaimed >= wipBudget) {
            if (issueId) await auditWipDeferral(agent, queuedRun.id, issueId, wipCfg, wipBudget);
            continue; // leave queued; steer the agent to finish in-progress work first
          }
          const claimed = await claimQueuedRun(queuedRun, companyAgents);
```

Insert the claim-gate block between the `isNewStart` line and the WIP check:

```ts
        for (const queuedRun of prioritizedRuns) {
          if (claimedRuns.length >= budget) break;
          const issueId = readNonEmptyString(parseObject(queuedRun.contextSnapshot).issueId);
          const isNewStart = isNewStartIssueStatus(issueId ? issueById.get(issueId)?.status : null);
          const claimWsId = issueId ? issueById.get(issueId)?.executionWorkspaceId ?? null : null;
          const contendingClaimCount = claimWsId ? claimCounts.get(claimWsId) ?? 0 : 0;
          const claimDecision = decideClaimScheduling({
            enabled: claimSchedEnabled,
            isNewStart,
            activeClaimCount: contendingClaimCount,
            queuedForMs: claimNow.getTime() - new Date(queuedRun.createdAt).getTime(),
            boundMs: DEFAULT_CLAIM_TTL_MS,
          });
          if (claimDecision !== "admit" && issueId && claimWsId) {
            await auditClaimScheduling(
              agent,
              queuedRun.id,
              issueId,
              claimDecision === "defer"
                ? "issue.start_deferred_path_claim"
                : "issue.start_admitted_despite_path_claim",
              {
                executionWorkspaceId: claimWsId,
                contendingClaimCount,
                queuedForMs: claimNow.getTime() - new Date(queuedRun.createdAt).getTime(),
                boundMs: DEFAULT_CLAIM_TTL_MS,
              },
            );
          }
          if (claimDecision === "defer") {
            continue; // leave queued; another run is actively editing this shared workspace
          }
          if (isNewStart && newStartsClaimed >= wipBudget) {
            if (issueId) await auditWipDeferral(agent, queuedRun.id, issueId, wipCfg, wipBudget);
            continue; // leave queued; steer the agent to finish in-progress work first
          }
          const claimed = await claimQueuedRun(queuedRun, companyAgents);
```

(The claim gate runs before the WIP check: `defer` leaves the run queued without touching `newStartsClaimed`; `admit_despite_claim` and `admit` fall through to the unchanged WIP logic.)

- [ ] **Step 8: Run the integration test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/heartbeat-claim-aware-selection-tick.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 9: Guard against regressions in the sibling seam**

Run: `cd server && npx vitest run src/__tests__/heartbeat-wip-enforcement-tick.test.ts`
Expected: PASS (WIP behavior unchanged — claim gate is inert when the flag is off, which the WIP test does not enable).

- [ ] **Step 10: Typecheck**

Run: `cd server && pnpm typecheck`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/heartbeat-claim-aware-selection-tick.test.ts
git commit -m "feat(workspace): claim-aware run selection gate in startNextQueuedRunForAgent (4B slice 3)"
```

---

## Self-Review

**Spec coverage:**
- Pure `decideClaimScheduling` (5 branches + boundary) → Task 1. ✓
- Batched `activeClaimCountsForWorkspaces` with `expiresAt > now` filter → Task 2. ✓
- Instance-level `workspaceClaimAwareScheduling`, default off → Task 3 (schema + type + normalize carry). ✓
- Wiring in `claimUpTo`, composing with WIP, new-starts-only, audits, fault isolation → Task 4. ✓
- Exit criteria (defer/continuation-proceeds/off-is-identical/bounded-admit/no-throw) → Task 4 integration test's four scenarios + fault-isolation via the try/catch. ✓
- Out-of-scope (per-company override, subtree-precise, claim lifecycle changes) → not implemented, as specified. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The one reference-to-existing-file (Task 4 harness scaffold) names the exact template file and lists the concrete deltas + full novel assertions — not "similar to Task N."

**Type consistency:** `decideClaimScheduling` input shape identical in Task 1 definition and Task 4 call site. `activeClaimCountsForWorkspaces(string[], Date): Promise<Map<string, number>>` identical in Task 2 and Task 4. `workspaceClaimAwareScheduling` spelled identically across validator, type, normalize, `getGeneral()` read, and test. Audit action strings identical between the helper's union type, the call site, and the test queries.
