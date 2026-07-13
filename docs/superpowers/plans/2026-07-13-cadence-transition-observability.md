# Cadence-Transition Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On each idle-backoff cadence transition, emit one `activity_log` entry carrying the interval change and a snapshot of the agent's actionable backlog, so the question "do agents back off while assignable work waits?" becomes a queryable signal (the decision gate for idea 035's deferred speed-up-under-load slice).

**Architecture:** A pure `cadenceTransition` helper decides whether the effective interval changed and in which direction. A lightweight `startableIssueCountForAgent` query supplies the backlog snapshot. Both are consumed at the existing `applyIdleStreakUpdate` seam in `heartbeat.ts`, which emits a best-effort audit entry only when the interval actually changes.

**Tech Stack:** TypeScript, Drizzle ORM, Vitest (+ embedded Postgres), pnpm workspaces.

## Global Constraints

- **Observability only.** No change to backoff *behavior*. The streak write in `applyIdleStreakUpdate` is untouched; the audit is additive.
- **Fire only on transition.** Emit an entry only when the effective interval changes (`cadenceTransition().changed`), never on every heartbeat — this bounds volume to a few entries per idle period.
- **Best-effort / fault-isolated.** The backlog query + `logActivity` are wrapped in one try/catch that logs a warn and swallows. A failure here must never disturb the heartbeat finalize path or the streak update. Mirror the existing `auditWipDeferral` pattern.
- **Backlog count is a documented proxy.** Reuse `WIP_NEW_START_STATUSES` (`todo | backlog | blocked`) from `wip-flow.ts`; it does not check dependency readiness (acceptable upper bound for a signal).
- **Audit shape:** `actorType: "system"`, `actorId: "heartbeat-cadence"`, `entityType: "agent"`, `entityId: agentId`, `action: "agent.heartbeat_cadence_transition"`, `details: { direction, oldStreak, newStreak, oldIntervalSec, newIntervalSec, wakeReason, outcome, actionableBacklogCount }`. `direction` ∈ `"backoff" | "reset"`.
- **No schema migration** (activity_log details are free-text JSON).
- **Import extensions:** files in `server/src/services/` import siblings with `.js` (e.g. `./heartbeat-cadence.js`, `./wip-flow.js`). Files in `server/src/__tests__/` use `.ts`. (This convention is enforced by tsc — `.ts` in a `services/` import fails with TS5097.)
- Run tests: `cd server && npx vitest run <path>`. Typecheck: `cd server && pnpm typecheck`. Never use `pnpm --filter @paperclipai/server test` (it silently no-ops).

---

## File Structure

- Modify `server/src/services/heartbeat-cadence.ts` — add pure `cadenceTransition` (Task 1).
- Modify `server/src/services/heartbeat-cadence.test.ts` — unit tests (Task 1).
- Modify `server/src/services/issues.ts` — add `startableIssueCountForAgent` (Task 2).
- Create `server/src/__tests__/issues-startable-count.test.ts` — service test (Task 2).
- Modify `server/src/services/heartbeat.ts` — emit the audit in `applyIdleStreakUpdate` (Task 3).
- Create `server/src/__tests__/heartbeat-cadence-transition-observability.test.ts` — integration test (Task 3).

---

### Task 1: Pure `cadenceTransition` helper

**Files:**
- Modify: `server/src/services/heartbeat-cadence.ts`
- Test: `server/src/services/heartbeat-cadence.test.ts`

**Interfaces:**
- Consumes: existing `effectiveIntervalSec(baseSec, streak, cfg)` and `IdleBackoffConfig` (already in this file).
- Produces: `cadenceTransition(baseSec: number, oldStreak: number, newStreak: number, cfg: IdleBackoffConfig): { changed: boolean; direction: "backoff" | "reset"; oldIntervalSec: number; newIntervalSec: number }`.

- [ ] **Step 1: Write the failing test**

Append to `server/src/services/heartbeat-cadence.test.ts` (reuse its existing imports; add `cadenceTransition` to the import from `./heartbeat-cadence.js`). Base config: `{ enabled: true, multiplier: 2, maxIntervalSec: 480 }`, base interval 60s.

```ts
describe("cadenceTransition", () => {
  const cfg = { enabled: true, multiplier: 2, maxIntervalSec: 480 };

  it("flags a backoff when the interval grows (streak 0 -> 1)", () => {
    const t = cadenceTransition(60, 0, 1, cfg);
    expect(t).toEqual({ changed: true, direction: "backoff", oldIntervalSec: 60, newIntervalSec: 120 });
  });

  it("flags a reset when the interval snaps back (streak 3 -> 0)", () => {
    const t = cadenceTransition(60, 3, 0, cfg);
    expect(t.changed).toBe(true);
    expect(t.direction).toBe("reset");
    expect(t.oldIntervalSec).toBe(480); // 60*2^3=480 capped at 480
    expect(t.newIntervalSec).toBe(60);
  });

  it("reports no change once the interval is pinned at the cap (streak 3 -> 4)", () => {
    const t = cadenceTransition(60, 3, 4, cfg);
    expect(t.changed).toBe(false); // both capped at 480
  });

  it("reports no change when the streak is unchanged (0 -> 0)", () => {
    expect(cadenceTransition(60, 0, 0, cfg).changed).toBe(false);
  });

  it("reports no change when backoff is disabled", () => {
    const t = cadenceTransition(60, 0, 5, { enabled: false, multiplier: 2, maxIntervalSec: 480 });
    expect(t.changed).toBe(false); // effectiveIntervalSec returns base when disabled
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/heartbeat-cadence.test.ts -t "cadenceTransition"`
Expected: FAIL — `cadenceTransition is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `server/src/services/heartbeat-cadence.ts` (after `effectiveIntervalSec`):

```ts
/**
 * Whether an idle-streak change moves the agent's *effective* interval, and
 * which way. `changed` is false when the interval is unchanged (streak grew
 * but already pinned at the cap, no streak change, or backoff disabled) — the
 * caller uses this to emit a cadence-transition audit only on real transitions.
 * `direction` is only meaningful when `changed` is true.
 */
export function cadenceTransition(
  baseSec: number,
  oldStreak: number,
  newStreak: number,
  cfg: IdleBackoffConfig,
): { changed: boolean; direction: "backoff" | "reset"; oldIntervalSec: number; newIntervalSec: number } {
  const oldIntervalSec = effectiveIntervalSec(baseSec, oldStreak, cfg);
  const newIntervalSec = effectiveIntervalSec(baseSec, newStreak, cfg);
  return {
    changed: newIntervalSec !== oldIntervalSec,
    direction: newIntervalSec > oldIntervalSec ? "backoff" : "reset",
    oldIntervalSec,
    newIntervalSec,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/services/heartbeat-cadence.test.ts`
Expected: PASS (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/heartbeat-cadence.ts server/src/services/heartbeat-cadence.test.ts
git commit -m "feat(heartbeat): pure cadenceTransition helper (035 observability)"
```

---

### Task 2: `startableIssueCountForAgent` query

**Files:**
- Modify: `server/src/services/issues.ts` (add method on the object returned by `issueService`, next to `inProgressIssueCountsByAgent` ~line 6477)
- Test: `server/src/__tests__/issues-startable-count.test.ts` (create)

**Interfaces:**
- Consumes: `issues` table, `WIP_NEW_START_STATUSES` from `./wip-flow.js`, drizzle `and`/`eq`/`inArray`/`sql` (already imported in issues.ts).
- Produces: `issueService(db).startableIssueCountForAgent(companyId: string, agentId: string): Promise<number>` — count of issues assigned to the agent whose status is in `WIP_NEW_START_STATUSES`.

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/issues-startable-count.test.ts`. Model the embedded-Postgres harness (beforeAll/afterEach/afterAll + `getEmbeddedPostgresTestSupport`/`startEmbeddedPostgresTestDatabase`) on `server/src/__tests__/workspace-path-claims-service.test.ts` — read that file for the exact setup. Seed a company, two agents, a project, and issues:

```ts
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { createDb, companies, agents, projects, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.ts";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping embedded Postgres issues-startable-count tests: ${support.reason ?? "unsupported"}`);
}

describeEmbeddedPostgres("issueService.startableIssueCountForAgent", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-startable-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => { await tempDb?.cleanup(); });

  async function seed() {
    const companyId = randomUUID();
    const agentA = randomUUID();
    const agentB = randomUUID();
    const projectId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "P", issuePrefix: "STB", requireBoardApprovalForNewAgents: false });
    await db.insert(agents).values([{ id: agentA, companyId, name: "A" }, { id: agentB, companyId, name: "B" }]);
    await db.insert(projects).values({ id: projectId, companyId, name: "Proj" });
    return { companyId, agentA, agentB, projectId };
  }

  it("counts only the agent's own issues in a startable status", async () => {
    const { companyId, agentA, agentB, projectId } = await seed();
    const mk = (assignee: string, status: string) =>
      db.insert(issues).values({ id: randomUUID(), companyId, projectId, title: "t", status, assigneeAgentId: assignee });
    await mk(agentA, "todo");
    await mk(agentA, "backlog");
    await mk(agentA, "blocked");
    await mk(agentA, "in_progress"); // excluded: not startable
    await mk(agentA, "done");        // excluded
    await mk(agentB, "todo");        // excluded: other agent

    expect(await svc.startableIssueCountForAgent(companyId, agentA)).toBe(3);
    expect(await svc.startableIssueCountForAgent(companyId, agentB)).toBe(1);
  });

  it("returns 0 for an agent with no startable work", async () => {
    const { companyId, agentB } = await seed();
    expect(await svc.startableIssueCountForAgent(companyId, agentB)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/issues-startable-count.test.ts`
Expected: FAIL — `svc.startableIssueCountForAgent is not a function`.

- [ ] **Step 3: Add the import for the status set**

In `server/src/services/issues.ts`, add near the other service imports (top of file):

```ts
import { WIP_NEW_START_STATUSES } from "./wip-flow.js";
```

(`wip-flow.ts` is a pure module with no import of `issues.ts`, so this introduces no cycle.)

- [ ] **Step 4: Add the method**

In `server/src/services/issues.ts`, inside the object returned by `issueService(db)`, add immediately after `inProgressIssueCountsByAgent` (ends ~line 6493):

```ts
    startableIssueCountForAgent: async (companyId: string, agentId: string): Promise<number> => {
      const rows = await db
        .select({ count: sql<number>`count(*)` })
        .from(issues)
        .where(and(
          eq(issues.companyId, companyId),
          eq(issues.assigneeAgentId, agentId),
          inArray(issues.status, [...WIP_NEW_START_STATUSES]),
        ));
      return Number(rows[0]?.count ?? 0);
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/issues-startable-count.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/issues.ts server/src/__tests__/issues-startable-count.test.ts
git commit -m "feat(issues): startableIssueCountForAgent query (035 observability)"
```

---

### Task 3: Emit cadence-transition audit in `applyIdleStreakUpdate`

**Files:**
- Modify: `server/src/services/heartbeat.ts` (`applyIdleStreakUpdate`, ~line 13250; import `cadenceTransition` near the existing `heartbeat-cadence` imports ~line 193)
- Test: `server/src/__tests__/heartbeat-cadence-transition-observability.test.ts` (create)

**Interfaces:**
- Consumes: `cadenceTransition` (Task 1), `issuesSvc.startableIssueCountForAgent` (Task 2, `issuesSvc` is in scope at heartbeat.ts:3440), existing `parseHeartbeatCadenceConfig`, `nextIdleStreak`, `isEmptyTimerHeartbeat`, `logActivity`, `logger`. The agent row provides `companyId` and `heartbeatIdleStreak`.
- Produces: no new exported symbol; observable behavior is the `agent.heartbeat_cadence_transition` audit entry, asserted via `activity_log` after calling `heartbeat.applyIdleStreakUpdate(...)`.

- [ ] **Step 1: Write the failing integration test**

Create `server/src/__tests__/heartbeat-cadence-transition-observability.test.ts`. Model the harness on `server/src/__tests__/heartbeat-idle-streak.test.ts` (read it first) — it constructs `heartbeatService(db)` over embedded Postgres and calls `applyIdleStreakUpdate` directly. Seed an agent whose `runtimeConfig.heartbeat` enables backoff: `{ intervalSec: 60, idleBackoff: { enabled: true, multiplier: 2, maxIntervalSec: 480 } }`, plus some startable issues assigned to it. Signals: an empty-timer signal is `{ wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: null }` (drives streak 0→1 = backoff transition); a productive signal is `{ wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: <a member of PRODUCTIVE_RUN_LIVENESS_STATES> }` or an event wake `{ wakeReason: "assignment", outcome: "succeeded", livenessState: null }` (resets streak → reset transition). Query `activity_log` for `action = "agent.heartbeat_cadence_transition"`.

Assertions:
```ts
  it("logs a backoff transition with a backlog snapshot on the first empty heartbeat", async () => {
    const { agentId } = await seedBackoffAgentWithBacklog(3); // 3 startable issues
    await heartbeat.applyIdleStreakUpdate(agentId, { wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: null });
    const rows = await db.select().from(activityLog)
      .where(and(eq(activityLog.action, "agent.heartbeat_cadence_transition"), eq(activityLog.entityId, agentId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toMatchObject({ direction: "backoff", oldStreak: 0, newStreak: 1, oldIntervalSec: 60, newIntervalSec: 120, actionableBacklogCount: 3 });
  });

  it("logs a reset transition when a productive/event wake collapses the streak", async () => {
    const { agentId } = await seedBackoffAgentWithBacklog(0, /*initialStreak*/ 2);
    await heartbeat.applyIdleStreakUpdate(agentId, { wakeReason: "assignment", outcome: "succeeded", livenessState: null });
    const rows = await db.select().from(activityLog)
      .where(and(eq(activityLog.action, "agent.heartbeat_cadence_transition"), eq(activityLog.entityId, agentId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toMatchObject({ direction: "reset", newStreak: 0, actionableBacklogCount: 0 });
  });

  it("writes no entry when the interval is unchanged (already at cap)", async () => {
    // maxIntervalSec 480, base 60, multiplier 2 => cap reached at streak 3; 3 -> 4 pins.
    const { agentId } = await seedBackoffAgentWithBacklog(1, /*initialStreak*/ 3);
    await heartbeat.applyIdleStreakUpdate(agentId, { wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: null });
    const rows = await db.select().from(activityLog).where(eq(activityLog.action, "agent.heartbeat_cadence_transition"));
    expect(rows).toHaveLength(0);
  });

  it("fails open: a backlog-count error does not break the streak update or throw", async () => {
    const { agentId } = await seedBackoffAgentWithBacklog(1);
    // Force the count query to throw (spy on the heartbeat's issue service seam; see note).
    const restore = forceStartableCountToThrow();
    await expect(heartbeat.applyIdleStreakUpdate(agentId, { wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: null }))
      .resolves.toBe(1); // streak still advanced to 1
    restore();
    const rows = await db.select().from(activityLog).where(eq(activityLog.action, "agent.heartbeat_cadence_transition"));
    expect(rows).toHaveLength(0); // audit skipped, but no throw
  });
```

Write `seedBackoffAgentWithBacklog(startableCount, initialStreak = 0)` to insert the company/project/agent (with the backoff runtimeConfig and `heartbeatIdleStreak: initialStreak`) and `startableCount` issues in `todo` status assigned to it. For `forceStartableCountToThrow`, use `vi.spyOn` on the issue-service method the heartbeat uses — if it isn't reachable from the test, induce the throw via the DB seam the query reads (mirror how the slice-3 test forced `activeClaimCountsForWorkspaces` to throw in `heartbeat-claim-aware-selection-tick.test.ts`); if neither is possible without touching production code, omit this one case and note it. `activityLog`, `and`, `eq` come from the same imports the idle-streak test / other `__tests__` files use.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/heartbeat-cadence-transition-observability.test.ts`
Expected: FAIL — no `agent.heartbeat_cadence_transition` rows are written (audit not implemented yet).

- [ ] **Step 3: Add the import**

In `server/src/services/heartbeat.ts`, add `cadenceTransition` to the existing import from `./heartbeat-cadence.js` (near line 193, alongside `effectiveIntervalSec`, `nextIdleStreak`, etc.):

```ts
  cadenceTransition,
```

- [ ] **Step 4: Emit the audit in `applyIdleStreakUpdate`**

In `server/src/services/heartbeat.ts`, replace the body of `applyIdleStreakUpdate` (currently lines ~13250–13267) with:

```ts
    applyIdleStreakUpdate: async (
      agentId: string,
      signal: { wakeReason: string | null; outcome: string; livenessState: RunLivenessState | null },
    ): Promise<number | null> => {
      const existing = await getAgent(agentId);
      if (!existing) return null;
      const cadenceCfg = parseHeartbeatCadenceConfig(existing.runtimeConfig);
      if (!cadenceCfg.idleBackoff.enabled) {
        return existing.heartbeatIdleStreak;
      }
      const oldStreak = existing.heartbeatIdleStreak;
      const streak = nextIdleStreak(oldStreak, isEmptyTimerHeartbeat(signal));
      if (streak !== oldStreak) {
        await db
          .update(agents)
          .set({ heartbeatIdleStreak: streak, updatedAt: new Date() })
          .where(eq(agents.id, agentId));

        // Cadence-transition observability (idea 035 follow-up): on a real
        // interval change, record the transition + a backlog snapshot so we can
        // later answer "did the agent back off while assignable work waited?".
        // Best-effort — never disturbs the streak update or the finalize path.
        const transition = cadenceTransition(cadenceCfg.intervalSec, oldStreak, streak, cadenceCfg.idleBackoff);
        if (transition.changed) {
          try {
            const actionableBacklogCount = await issuesSvc.startableIssueCountForAgent(existing.companyId, agentId);
            await logActivity(db, {
              companyId: existing.companyId,
              actorType: "system",
              actorId: "heartbeat-cadence",
              agentId,
              action: "agent.heartbeat_cadence_transition",
              entityType: "agent",
              entityId: agentId,
              details: {
                direction: transition.direction,
                oldStreak,
                newStreak: streak,
                oldIntervalSec: transition.oldIntervalSec,
                newIntervalSec: transition.newIntervalSec,
                wakeReason: signal.wakeReason,
                outcome: signal.outcome,
                actionableBacklogCount,
              },
            });
          } catch (err) {
            logger.warn({ err, agentId }, "cadence-transition observability failed; continuing");
          }
        }
      }
      return streak;
    },
```

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/heartbeat-cadence-transition-observability.test.ts`
Expected: PASS.

- [ ] **Step 6: Guard the sibling idle-streak behavior**

Run: `cd server && npx vitest run src/__tests__/heartbeat-idle-streak.test.ts src/__tests__/heartbeat-idle-backoff-tick.test.ts`
Expected: PASS (streak update behavior unchanged — the audit is purely additive).

- [ ] **Step 7: Typecheck**

Run: `cd server && pnpm typecheck`
Expected: no errors (unrelated pre-existing errors elsewhere are out of scope; introduce none).

- [ ] **Step 8: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/heartbeat-cadence-transition-observability.test.ts
git commit -m "feat(heartbeat): emit cadence-transition audit with backlog snapshot (035 observability)"
```

---

## Self-Review

**Spec coverage** (against `2026-07-13-cadence-transition-observability-scope.md`):
- Emit on transition only → Task 1 `cadenceTransition().changed` + Task 3 `if (transition.changed)`. ✓
- Backlog snapshot via a startable-status count reusing `WIP_NEW_START_STATUSES` → Task 2. ✓
- Both directions (backoff + reset) → Task 1 `direction` + Task 3 tests. ✓
- Audit shape (actor/action/entity/details) → Task 3 Global Constraints + code. ✓
- Fault isolation (try/catch, swallow, streak untouched) → Task 3 code + fail-open test. ✓
- No migration, no behavior change → no schema task; streak write byte-unchanged. ✓
- The answer-query is documented in the scope doc; no code needed. ✓

**Placeholder scan:** Every code step shows full code. Task 2's and Task 3's tests name the exact template files to copy the embedded-PG harness from (`workspace-path-claims-service.test.ts`, `heartbeat-idle-streak.test.ts`) and give the full novel assertions + seed responsibilities — not "similar to Task N."

**Type consistency:** `cadenceTransition(baseSec, oldStreak, newStreak, cfg)` return shape identical in Task 1 definition and Task 3 call. `startableIssueCountForAgent(companyId, agentId): Promise<number>` identical in Task 2 and the Task 3 call site. `action: "agent.heartbeat_cadence_transition"` and the `details` keys spelled identically across Task 3 code and all Task 3 test assertions.
