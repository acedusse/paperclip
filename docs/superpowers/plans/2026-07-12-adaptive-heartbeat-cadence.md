# Adaptive Heartbeat Cadence — Idle Backoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After consecutive empty timer heartbeats, exponentially lengthen an agent's effective wake interval (capped), snapping back to base the instant a productive heartbeat runs — cutting idle token burn while keeping event-driven wakes instant.

**Architecture:** One integer column `agents.heartbeat_idle_streak` tracks the consecutive-empty count, updated at the existing per-agent completion write seam (`finalizeAgentStatus`). A pure module derives the effective interval from `base × multiplier^streak` (capped) and classifies whether a completed run was an "empty heartbeat." The scheduler's due-gate (`tickTimers`) consults the effective interval instead of the raw configured interval. Event wakes are untouched — they bypass the timer entirely, so responsiveness is preserved by construction.

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL), Zod (shared validators), Vitest, React (UI). pnpm workspaces (`@paperclipai/db`, `@paperclipai/shared`, `server`, `ui`).

## Global Constraints

- **Idle backoff is opt-in per agent.** `idleBackoff.enabled` defaults to `false`; with it off, cadence must reproduce today's behavior tick-for-tick.
- **Migration number is `0113`** (not `0112`) — `0112_spend_schedule` is reserved by the unmerged Phase 3b branch; skipping avoids a collision on merge. The numbering guard (`check-migration-numbering.ts`) enforces no-duplicates + ordering + journal/file match, but **not** contiguity, so a gap is legal.
- **The empty-heartbeat signal is the run outcome, never a tick-time proxy.** Empty = `wakeReason === "heartbeat_timer"` AND `outcome === "succeeded"` AND `livenessState` NOT in the productive set. Any other completion (event wake, failure, productive run) resets the streak to 0.
- **Productive liveness states** (single source of truth, shared constant): `advanced`, `completed`, `blocked`, `needs_followup`.
- **The effective interval is always ≥ base**, even under misconfiguration (defensive clamp in the pure function).

---

## File Structure

- `packages/db/src/migrations/0113_heartbeat_idle_streak.sql` — new column DDL
- `packages/db/src/migrations/meta/_journal.json` — journal entry (idx 112)
- `packages/db/src/schema/agents.ts` — column definition
- `packages/shared/src/constants.ts` — `PRODUCTIVE_RUN_LIVENESS_STATES` constant
- `packages/shared/src/types/agent.ts` — `heartbeatIdleStreak` on `Agent`
- `packages/shared/src/validators/agent-heartbeat.ts` (new) — `idleBackoffSchema`, `IdleBackoffConfig`
- `server/src/services/heartbeat-cadence.ts` (new) — pure `effectiveIntervalSec`, `nextIdleStreak`, `isEmptyTimerHeartbeat`
- `server/src/services/heartbeat-cadence.test.ts` (new) — unit tests for the pure module
- `server/src/services/heartbeat.ts` — `parseHeartbeatPolicy`, `finalizeAgentStatus`, `tickTimers` wiring
- `server/src/services/recovery/successful-run-handoff.ts` — reuse shared productive-states constant
- `server/src/routes/agents.ts` — expose `heartbeatIdleStreak` + computed `effectiveHeartbeatIntervalSec`
- `ui/src/api/agents.ts` + agent settings/status UI — readout + config controls

---

## Task 1: Add `heartbeat_idle_streak` column + migration

**Files:**
- Create: `packages/db/src/migrations/0113_heartbeat_idle_streak.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/agents.ts` (after the `lastHeartbeatAt` column, ~line 50)

**Interfaces:**
- Produces: `agents.heartbeatIdleStreak` (Drizzle column, `integer NOT NULL DEFAULT 0`)

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/src/migrations/0113_heartbeat_idle_streak.sql`:

```sql
ALTER TABLE "agents" ADD COLUMN "heartbeat_idle_streak" integer DEFAULT 0 NOT NULL;
```

- [ ] **Step 2: Append the journal entry**

In `packages/db/src/migrations/meta/_journal.json`, append to the `entries` array (after the `0111_predictive_breaker` entry, which has `idx: 111`):

```json
{
  "idx": 112,
  "version": "7",
  "when": 1781902700000,
  "tag": "0113_heartbeat_idle_streak",
  "breakpoints": true
}
```

- [ ] **Step 3: Add the column to the Drizzle schema**

In `packages/db/src/schema/agents.ts`, immediately after the `lastHeartbeatAt` line:

```ts
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    // Combo-01 Phase 4A: consecutive empty timer-heartbeat count driving idle backoff.
    heartbeatIdleStreak: integer("heartbeat_idle_streak").notNull().default(0),
```

Confirm `integer` is already imported at the top of the file (it is — `budgetMonthlyCents` uses it).

- [ ] **Step 4: Run the numbering guard + typecheck**

Run: `pnpm --filter @paperclipai/db run check:migrations`
Expected: exits 0 (no duplicate/order/mismatch errors).

Run: `pnpm --filter @paperclipai/db run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/0113_heartbeat_idle_streak.sql packages/db/src/migrations/meta/_journal.json packages/db/src/schema/agents.ts
git commit -m "feat(db): heartbeat_idle_streak column on agents (combo-01 4A)"
```

---

## Task 2: Shared constant, config schema, and Agent type field

**Files:**
- Modify: `packages/shared/src/constants.ts` (after `RUN_LIVENESS_STATES`, ~line 685)
- Create: `packages/shared/src/validators/agent-heartbeat.ts`
- Create: `packages/shared/src/validators/agent-heartbeat.test.ts`
- Modify: `packages/shared/src/types/agent.ts` (after `lastHeartbeatAt`, ~line 115)
- Modify: `packages/shared/src/index.ts` (export the new validator module)

**Interfaces:**
- Produces:
  - `PRODUCTIVE_RUN_LIVENESS_STATES: ReadonlySet<RunLivenessState>` = `{advanced, completed, blocked, needs_followup}`
  - `idleBackoffSchema` (Zod) and `type IdleBackoffConfig = { enabled: boolean; multiplier: number; maxIntervalSec: number }`
  - `Agent.heartbeatIdleStreak: number`

- [ ] **Step 1: Write the failing validator test**

Create `packages/shared/src/validators/agent-heartbeat.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { idleBackoffSchema } from "./agent-heartbeat.js";

describe("idleBackoffSchema", () => {
  it("defaults to disabled with multiplier 2 when empty", () => {
    const parsed = idleBackoffSchema.parse({});
    expect(parsed).toEqual({ enabled: false, multiplier: 2, maxIntervalSec: 3600 });
  });

  it("accepts a valid config", () => {
    const parsed = idleBackoffSchema.parse({ enabled: true, multiplier: 3, maxIntervalSec: 1800 });
    expect(parsed).toEqual({ enabled: true, multiplier: 3, maxIntervalSec: 1800 });
  });

  it("rejects multiplier <= 1", () => {
    expect(() => idleBackoffSchema.parse({ multiplier: 1 })).toThrow();
  });

  it("rejects non-positive maxIntervalSec", () => {
    expect(() => idleBackoffSchema.parse({ maxIntervalSec: 0 })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @paperclipai/shared exec vitest run src/validators/agent-heartbeat.test.ts`
Expected: FAIL — cannot resolve `./agent-heartbeat.js`.

- [ ] **Step 3: Write the validator module**

Create `packages/shared/src/validators/agent-heartbeat.ts`:

```ts
import { z } from "zod";

/**
 * Combo-01 Phase 4A idle-backoff config, stored under
 * `runtimeConfig.heartbeat.idleBackoff`. Disabled by default so existing
 * agents keep their fixed cadence until an operator opts in.
 */
export const idleBackoffSchema = z.object({
  enabled: z.boolean().default(false),
  multiplier: z.number().gt(1).default(2),
  maxIntervalSec: z.number().int().positive().default(3600),
});

export type IdleBackoffConfig = z.infer<typeof idleBackoffSchema>;
```

- [ ] **Step 4: Add the shared productive-states constant**

In `packages/shared/src/constants.ts`, immediately after the `RunLivenessState` type export (~line 685):

```ts
/**
 * Liveness states that indicate a successful run made concrete progress.
 * Single source of truth shared by recovery handoff and heartbeat idle-backoff.
 */
export const PRODUCTIVE_RUN_LIVENESS_STATES: ReadonlySet<RunLivenessState> = new Set([
  "advanced",
  "completed",
  "blocked",
  "needs_followup",
]);
```

- [ ] **Step 5: Add the Agent type field**

In `packages/shared/src/types/agent.ts`, immediately after `lastHeartbeatAt: Date | null;`:

```ts
  lastHeartbeatAt: Date | null;
  /** Combo-01 Phase 4A: consecutive empty timer-heartbeat count (0 when active). */
  heartbeatIdleStreak: number;
  /** Combo-01 Phase 4A: computed effective wake interval (read-only; set by the read path). */
  effectiveHeartbeatIntervalSec?: number;
```

- [ ] **Step 6: Export the validator module**

In `packages/shared/src/index.ts`, add alongside the other validator exports:

```ts
export * from "./validators/agent-heartbeat.js";
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @paperclipai/shared exec vitest run src/validators/agent-heartbeat.test.ts`
Expected: PASS (4 tests).

Run: `pnpm --filter @paperclipai/shared run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/validators/agent-heartbeat.ts packages/shared/src/validators/agent-heartbeat.test.ts packages/shared/src/constants.ts packages/shared/src/types/agent.ts packages/shared/src/index.ts
git commit -m "feat(shared): idle-backoff config schema + productive-liveness constant"
```

---

## Task 3: Pure cadence module

**Files:**
- Create: `server/src/services/heartbeat-cadence.ts`
- Create: `server/src/services/heartbeat-cadence.test.ts`

**Interfaces:**
- Consumes: `IdleBackoffConfig`, `PRODUCTIVE_RUN_LIVENESS_STATES`, `RunLivenessState` from `@paperclipai/shared`
- Produces:
  - `effectiveIntervalSec(baseSec: number, streak: number, cfg: IdleBackoffConfig): number`
  - `nextIdleStreak(currentStreak: number, isEmpty: boolean): number`
  - `isEmptyTimerHeartbeat(input: { wakeReason: string | null; outcome: string; livenessState: RunLivenessState | null }): boolean`

- [ ] **Step 1: Write the failing tests**

Create `server/src/services/heartbeat-cadence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { IdleBackoffConfig } from "@paperclipai/shared";
import { effectiveIntervalSec, isEmptyTimerHeartbeat, nextIdleStreak } from "./heartbeat-cadence.js";

const on: IdleBackoffConfig = { enabled: true, multiplier: 2, maxIntervalSec: 3600 };

describe("effectiveIntervalSec", () => {
  it("returns base when disabled", () => {
    expect(effectiveIntervalSec(300, 5, { ...on, enabled: false })).toBe(300);
  });
  it("returns base at streak 0", () => {
    expect(effectiveIntervalSec(300, 0, on)).toBe(300);
  });
  it("grows exponentially with the streak", () => {
    expect(effectiveIntervalSec(300, 1, on)).toBe(600);
    expect(effectiveIntervalSec(300, 3, on)).toBe(2400);
  });
  it("clamps at maxIntervalSec", () => {
    expect(effectiveIntervalSec(300, 10, on)).toBe(3600);
  });
  it("never returns below base even if max < base", () => {
    expect(effectiveIntervalSec(300, 0, { ...on, maxIntervalSec: 60 })).toBe(300);
  });
});

describe("nextIdleStreak", () => {
  it("increments on an empty heartbeat", () => {
    expect(nextIdleStreak(3, true)).toBe(4);
  });
  it("resets to 0 on a non-empty completion", () => {
    expect(nextIdleStreak(3, false)).toBe(0);
  });
});

describe("isEmptyTimerHeartbeat", () => {
  it("is true for a successful timer wake with no concrete progress", () => {
    expect(isEmptyTimerHeartbeat({ wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: "empty_response" })).toBe(true);
    expect(isEmptyTimerHeartbeat({ wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: "plan_only" })).toBe(true);
    expect(isEmptyTimerHeartbeat({ wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: null })).toBe(true);
  });
  it("is false when the run made concrete progress", () => {
    expect(isEmptyTimerHeartbeat({ wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: "advanced" })).toBe(false);
  });
  it("is false for non-timer wakes", () => {
    expect(isEmptyTimerHeartbeat({ wakeReason: "issue_monitor_due", outcome: "succeeded", livenessState: "empty_response" })).toBe(false);
  });
  it("is false for non-success outcomes", () => {
    expect(isEmptyTimerHeartbeat({ wakeReason: "heartbeat_timer", outcome: "failed", livenessState: "empty_response" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter server exec vitest run src/services/heartbeat-cadence.test.ts`
Expected: FAIL — cannot resolve `./heartbeat-cadence.js`.

- [ ] **Step 3: Write the pure module**

Create `server/src/services/heartbeat-cadence.ts`:

```ts
import { PRODUCTIVE_RUN_LIVENESS_STATES, type IdleBackoffConfig, type RunLivenessState } from "@paperclipai/shared";

/**
 * Effective timer interval for an agent given its idle streak. Grows
 * geometrically while idle, capped at maxIntervalSec, and never drops below
 * the configured base (defensive against a misconfigured cap < base).
 */
export function effectiveIntervalSec(baseSec: number, streak: number, cfg: IdleBackoffConfig): number {
  if (!cfg.enabled) return baseSec;
  const grown = baseSec * cfg.multiplier ** Math.max(0, streak);
  const cap = Math.max(baseSec, cfg.maxIntervalSec);
  return Math.min(grown, cap);
}

/** Increment on an empty heartbeat, otherwise reset to 0. */
export function nextIdleStreak(currentStreak: number, isEmpty: boolean): number {
  return isEmpty ? currentStreak + 1 : 0;
}

/**
 * An "empty heartbeat" is a timer-driven wake that succeeded without making
 * concrete progress. Failures and event-driven wakes are never empty (they
 * reset the streak). "No concrete progress" is the complement of the shared
 * productive-liveness set, so any future non-productive state counts as empty.
 */
export function isEmptyTimerHeartbeat(input: {
  wakeReason: string | null;
  outcome: string;
  livenessState: RunLivenessState | null;
}): boolean {
  if (input.wakeReason !== "heartbeat_timer") return false;
  if (input.outcome !== "succeeded") return false;
  return input.livenessState === null || !PRODUCTIVE_RUN_LIVENESS_STATES.has(input.livenessState);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter server exec vitest run src/services/heartbeat-cadence.test.ts`
Expected: PASS (all groups).

- [ ] **Step 5: Point recovery at the shared constant (DRY)**

In `server/src/services/recovery/successful-run-handoff.ts`, remove the local `PRODUCTIVE_SUCCESS_LIVENESS_STATES` set (lines ~40-45) and import the shared one. Replace the definition with an alias so the rest of the file is unchanged:

```ts
import { PRODUCTIVE_RUN_LIVENESS_STATES } from "@paperclipai/shared";
// ...existing imports...

const PRODUCTIVE_SUCCESS_LIVENESS_STATES = PRODUCTIVE_RUN_LIVENESS_STATES;
```

Run: `pnpm --filter server exec vitest run src/services/recovery/successful-run-handoff.test.ts`
Expected: PASS (unchanged behavior).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/heartbeat-cadence.ts server/src/services/heartbeat-cadence.test.ts server/src/services/recovery/successful-run-handoff.ts
git commit -m "feat(heartbeat): pure idle-backoff cadence module + shared productive-states"
```

---

## Task 4: Parse `idleBackoff` in `parseHeartbeatPolicy`

**Files:**
- Modify: `server/src/services/heartbeat.ts` — `parseHeartbeatPolicy` (~line 7059)

**Interfaces:**
- Consumes: `idleBackoffSchema` from `@paperclipai/shared`
- Produces: `parseHeartbeatPolicy(agent).idleBackoff: IdleBackoffConfig`

- [ ] **Step 1: Add `idleBackoff` to the policy parse**

In `parseHeartbeatPolicy` (heartbeat.ts:7063), add to the returned object (after `intervalSec`):

```ts
    return {
      enabled: asBoolean(heartbeat.enabled, false),
      intervalSec: Math.max(0, asNumber(heartbeat.intervalSec, 0)),
      idleBackoff: idleBackoffSchema.parse(parseObject(heartbeat.idleBackoff)),
```

Add the import at the top of `heartbeat.ts` (with the other `@paperclipai/shared` imports):

```ts
import { idleBackoffSchema } from "@paperclipai/shared";
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter server run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/heartbeat.ts
git commit -m "feat(heartbeat): parse idleBackoff config in heartbeat policy"
```

---

## Task 5: Update the idle streak on run completion

**Files:**
- Modify: `server/src/services/heartbeat.ts` — new `applyIdleStreakUpdate` service method + its call at the main completion caller (~line 10452)
- Test: `server/src/__tests__/heartbeat-idle-streak.test.ts` (new)

**Interfaces:**
- Consumes: `isEmptyTimerHeartbeat`, `nextIdleStreak` from `./heartbeat-cadence.js`; `finalizedRun.wakeReason`, `finalizedRun.livenessState`; `outcome`
- Produces: `heartbeat.applyIdleStreakUpdate(agentId, { wakeReason, outcome, livenessState }): Promise<number | null>` — persists and returns the new streak

**Design note:** The streak update is its own small **production** method (not a param threaded through `finalizeAgentStatus`'s five callers). It is called once, right after `finalizeAgentStatus`, at the single main completion path — the same place, so it still "reuses the completion write seam" (Approach C), while staying directly testable and leaving the failure/cancel callers untouched. It writes the `agents` row a second time; that extra UPDATE on completion is an acceptable cost for the isolation.

- [ ] **Step 1: Write the failing integration test**

Create `server/src/__tests__/heartbeat-idle-streak.test.ts`, modeled on `heartbeat-instance-admission.test.ts` — embedded-postgres harness (`startEmbeddedPostgresTestDatabase`, `getEmbeddedPostgresTestSupport`), raw Drizzle inserts into `companies`/`agents`, and the `heartbeatService(...)` factory. `seedAgent` is a local helper you write in this file (insert a company + one agent with the given `heartbeatIdleStreak`, return `{ heartbeat, db, agentId }`) — not a shared import.

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents } from "@paperclipai/db";
// + embedded-postgres helpers, createDb, company/agent seeding as in heartbeat-instance-admission.test.ts

describe("heartbeat idle streak", () => {
  it("increments after an empty timer heartbeat", async () => {
    const { heartbeat, db, agentId } = await seedAgent({ heartbeatIdleStreak: 0 });
    const next = await heartbeat.applyIdleStreakUpdate(agentId, {
      wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: "empty_response",
    });
    expect(next).toBe(1);
    const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(row.heartbeatIdleStreak).toBe(1);
  });

  it("resets to 0 after a productive timer heartbeat", async () => {
    const { heartbeat, agentId } = await seedAgent({ heartbeatIdleStreak: 4 });
    expect(await heartbeat.applyIdleStreakUpdate(agentId, {
      wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: "advanced",
    })).toBe(0);
  });

  it("resets to 0 when an event wake completes", async () => {
    const { heartbeat, agentId } = await seedAgent({ heartbeatIdleStreak: 4 });
    expect(await heartbeat.applyIdleStreakUpdate(agentId, {
      wakeReason: "issue_monitor_due", outcome: "succeeded", livenessState: "empty_response",
    })).toBe(0);
  });

  it("resets to 0 on a failed timer heartbeat", async () => {
    const { heartbeat, agentId } = await seedAgent({ heartbeatIdleStreak: 4 });
    expect(await heartbeat.applyIdleStreakUpdate(agentId, {
      wakeReason: "heartbeat_timer", outcome: "failed", livenessState: "empty_response",
    })).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter server exec vitest run src/__tests__/heartbeat-idle-streak.test.ts`
Expected: FAIL — `heartbeat.applyIdleStreakUpdate is not a function`.

- [ ] **Step 3: Add the `applyIdleStreakUpdate` method**

Add the import near the top of `heartbeat.ts` (with the other `./` service imports):

```ts
import { effectiveIntervalSec, isEmptyTimerHeartbeat, nextIdleStreak } from "./heartbeat-cadence.js";
```

Add the method to the object `heartbeatService` returns, next to `tickTimers`/`cancelRun` (~line 13040). `getAgent` and `db`/`agents`/`eq` are already in scope in the factory:

```ts
    applyIdleStreakUpdate: async (
      agentId: string,
      signal: { wakeReason: string | null; outcome: string; livenessState: RunLivenessState | null },
    ): Promise<number | null> => {
      const existing = await getAgent(agentId);
      if (!existing) return null;
      const streak = nextIdleStreak(existing.heartbeatIdleStreak, isEmptyTimerHeartbeat(signal));
      if (streak !== existing.heartbeatIdleStreak) {
        await db
          .update(agents)
          .set({ heartbeatIdleStreak: streak, updatedAt: new Date() })
          .where(eq(agents.id, agentId));
      }
      return streak;
    },
```

Ensure `RunLivenessState` is imported from `@paperclipai/shared` in `heartbeat.ts` (it already imports many shared types; add it to that import if absent).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter server exec vitest run src/__tests__/heartbeat-idle-streak.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Call it from the main completion path**

Immediately after the `finalizeAgentStatus(...)` call at heartbeat.ts:10452, add (using `finalizedRun`, in scope from ~10311, and `outcome`):

```ts
      await self.applyIdleStreakUpdate(agent.id, {
        wakeReason: (finalizedRun ?? run).wakeReason ?? null,
        outcome,
        livenessState: (finalizedRun ?? run).livenessState ?? null,
      });
```

If the factory does not already keep a reference to its own returned object, capture one: assign the returned object to a `const self = { ... }` (or reference the existing `service`/`heartbeat` variable the factory returns) so the completion path can call the same method the test calls. Confirm the factory's return-object variable name and use it; do **not** duplicate the streak logic inline.

- [ ] **Step 6: Run the completion + recovery suites for regressions**

Run: `pnpm --filter server exec vitest run src/__tests__/heartbeat-idle-streak.test.ts src/__tests__/heartbeat-instance-admission.test.ts src/services/recovery`
Expected: PASS.

Run: `pnpm --filter server run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/heartbeat-idle-streak.test.ts
git commit -m "feat(heartbeat): update idle streak on run completion"
```

---

## Task 6: Gate `tickTimers` on the effective interval

**Files:**
- Modify: `server/src/services/heartbeat.ts` — `tickTimers` (~line 13005-13014)
- Test: `server/src/__tests__/heartbeat-idle-backoff-tick.test.ts` (new)

**Interfaces:**
- Consumes: `effectiveIntervalSec` from `./heartbeat-cadence.js`; `agent.heartbeatIdleStreak`; `policy.idleBackoff`

- [ ] **Step 1: Write the failing integration test**

Create `server/src/__tests__/heartbeat-idle-backoff-tick.test.ts`, modeled on `heartbeat-instance-admission.test.ts` (embedded-postgres + raw Drizzle seeding + `heartbeatService(...)`). `tickTimers` returns `{ checked, enqueued, skipped }` — a fleet-wide count, not per-agent — so seed **exactly one** eligible/invokable agent per case (follow how the admission test makes an agent invokable: company `active`, a valid org chain, `runtimeConfig.heartbeat.enabled = true`) and assert on `result.enqueued`. `seedIdleAgent` is a local helper you write in this file that inserts that one agent with the given `intervalSec`, `idleBackoff`, `heartbeatIdleStreak`, and a `lastHeartbeatAt` at `now - lastHeartbeatAgoSec`.

```ts
import { describe, expect, it } from "vitest";
// + embedded-postgres helpers, createDb, drizzle, heartbeatService — as in heartbeat-instance-admission.test.ts

describe("tickTimers idle backoff", () => {
  const now = new Date("2026-07-12T00:00:00.000Z");

  it("does not wake a backed-off idle agent before the effective interval elapses", async () => {
    // base 300s, streak 3, multiplier 2 -> effective 2400s; last heartbeat 1000s ago (>300, <2400)
    const { heartbeat } = await seedIdleAgent({ intervalSec: 300, streak: 3, lastHeartbeatAgoSec: 1000, enabled: true });
    const result = await heartbeat.tickTimers(now);
    expect(result.enqueued).toBe(0);
  });

  it("wakes the same agent once the effective interval has elapsed", async () => {
    const { heartbeat } = await seedIdleAgent({ intervalSec: 300, streak: 3, lastHeartbeatAgoSec: 3000, enabled: true });
    const result = await heartbeat.tickTimers(now);
    expect(result.enqueued).toBe(1);
  });

  it("with backoff disabled, wakes at the base interval regardless of streak", async () => {
    const { heartbeat } = await seedIdleAgent({ intervalSec: 300, streak: 9, lastHeartbeatAgoSec: 400, enabled: false });
    const result = await heartbeat.tickTimers(now);
    expect(result.enqueued).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter server exec vitest run src/__tests__/heartbeat-idle-backoff-tick.test.ts`
Expected: FAIL — the backed-off agent is woken early (first test fails) because the gate still uses raw `intervalSec`.

- [ ] **Step 3: Replace the due-gate with the effective interval**

In `tickTimers` (heartbeat.ts:13012-13014), replace:

```ts
        const baseline = new Date(agent.lastHeartbeatAt ?? agent.createdAt).getTime();
        const elapsedMs = now.getTime() - baseline;
        if (elapsedMs < policy.intervalSec * 1000) continue;
```

with:

```ts
        const baseline = new Date(agent.lastHeartbeatAt ?? agent.createdAt).getTime();
        const elapsedMs = now.getTime() - baseline;
        const effectiveSec = effectiveIntervalSec(policy.intervalSec, agent.heartbeatIdleStreak, policy.idleBackoff);
        if (elapsedMs < effectiveSec * 1000) continue;
```

Add `effectiveIntervalSec` to the existing `./heartbeat-cadence.js` import from Task 5.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter server exec vitest run src/__tests__/heartbeat-idle-backoff-tick.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/heartbeat-idle-backoff-tick.test.ts
git commit -m "feat(heartbeat): gate timer wakes on effective idle-backoff interval"
```

---

## Task 7: Expose streak + effective interval on the agent read path

**Files:**
- Modify: `server/src/routes/agents.ts` (the agent read select/map, ~lines 1852 and 1882; and the two synthetic `lastHeartbeatAt: null` shapes at 2261, 2444)
- Test: extend an existing agents-route test or add `server/src/__tests__/agents-heartbeat-cadence-read.test.ts`

**Interfaces:**
- Consumes: `effectiveIntervalSec` from `./heartbeat-cadence.js`
- Produces:
  - a new exported helper in `heartbeat-cadence.ts`: `parseHeartbeatCadenceConfig(runtimeConfig: unknown): { intervalSec: number; idleBackoff: IdleBackoffConfig }`
  - agent read response includes `heartbeatIdleStreak: number` and `effectiveHeartbeatIntervalSec: number`

- [ ] **Step 1: Add the config-from-runtimeConfig helper (with unit test)**

`parseHeartbeatPolicy` is a closure inside the heartbeat service factory and can't be imported by the route. Add a standalone parser to `heartbeat-cadence.ts` so the route can compute the effective interval without the service. Add to `heartbeat-cadence.ts`:

```ts
import { idleBackoffSchema, type IdleBackoffConfig } from "@paperclipai/shared";

/** Parse just the fields idle-backoff needs from an agent's runtimeConfig blob. */
export function parseHeartbeatCadenceConfig(runtimeConfig: unknown): { intervalSec: number; idleBackoff: IdleBackoffConfig } {
  const hb = (runtimeConfig as { heartbeat?: Record<string, unknown> } | null)?.heartbeat ?? {};
  const intervalSec = typeof hb.intervalSec === "number" && hb.intervalSec > 0 ? hb.intervalSec : 0;
  return { intervalSec, idleBackoff: idleBackoffSchema.parse(hb.idleBackoff ?? {}) };
}
```

Add a unit test to `heartbeat-cadence.test.ts`:

```ts
import { parseHeartbeatCadenceConfig } from "./heartbeat-cadence.js";

describe("parseHeartbeatCadenceConfig", () => {
  it("extracts intervalSec and idleBackoff, defaulting a missing block", () => {
    expect(parseHeartbeatCadenceConfig({ heartbeat: { intervalSec: 300, idleBackoff: { enabled: true } } }))
      .toEqual({ intervalSec: 300, idleBackoff: { enabled: true, multiplier: 2, maxIntervalSec: 3600 } });
  });
  it("returns interval 0 and disabled backoff for an empty config", () => {
    expect(parseHeartbeatCadenceConfig(null)).toEqual({ intervalSec: 0, idleBackoff: { enabled: false, multiplier: 2, maxIntervalSec: 3600 } });
  });
});
```

Run: `pnpm --filter server exec vitest run src/services/heartbeat-cadence.test.ts`
Expected: PASS.

- [ ] **Step 2: Write the failing route test**

Add `server/src/__tests__/agents-heartbeat-cadence-read.test.ts`, modeled on the existing agents-route tests under `server/src/__tests__/` (find one that exercises the agent GET/read route and reuse its request harness). Seed one agent with `runtimeConfig.heartbeat = { enabled: true, intervalSec: 300, idleBackoff: { enabled: true, multiplier: 2, maxIntervalSec: 3600 } }` and `heartbeat_idle_streak = 2`, read it through the route, and assert:

```ts
it("exposes idle streak and effective heartbeat interval", async () => {
  const body = await getAgentViaRoute(agentId); // use the same request helper the sibling agents-route test uses
  expect(body.heartbeatIdleStreak).toBe(2);
  expect(body.effectiveHeartbeatIntervalSec).toBe(1200); // 300 * 2^2
});
```

`getAgentViaRoute` stands for whatever request mechanism the sibling test already uses (supertest-style call or direct handler invocation) — do not invent a new one.

Run: `pnpm --filter server exec vitest run src/__tests__/agents-heartbeat-cadence-read.test.ts`
Expected: FAIL — fields absent.

- [ ] **Step 3: Add the fields to the read select + mapping**

In `server/src/routes/agents.ts`, add `heartbeatIdleStreak: agentsTable.heartbeatIdleStreak` to the select (near line 1852). Import the helper:

```ts
import { effectiveIntervalSec, parseHeartbeatCadenceConfig } from "../services/heartbeat-cadence.js";
```

In the row→response map (near line 1882), add (parse once):

```ts
          lastHeartbeatAt: row.lastHeartbeatAt,
          heartbeatIdleStreak: row.heartbeatIdleStreak,
          effectiveHeartbeatIntervalSec: (() => {
            const cadence = parseHeartbeatCadenceConfig(row.runtimeConfig);
            return effectiveIntervalSec(cadence.intervalSec, row.heartbeatIdleStreak, cadence.idleBackoff);
          })(),
```

For the two synthetic shapes at 2261 and 2444 (`lastHeartbeatAt: null`), add `heartbeatIdleStreak: 0` and `effectiveHeartbeatIntervalSec: 0` to satisfy the type.

Also add `heartbeatIdleStreak` and `effectiveHeartbeatIntervalSec` to the shared/API response type these handlers return, if it is a distinct type from `Agent` (the `Agent` type already gained `heartbeatIdleStreak` in Task 2; add `effectiveHeartbeatIntervalSec?: number` there too if the route returns `Agent`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter server exec vitest run src/__tests__/agents-heartbeat-cadence-read.test.ts`
Expected: PASS.

Run: `pnpm --filter server run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/agents.ts server/src/services/heartbeat-cadence.ts server/src/services/heartbeat-cadence.test.ts server/src/__tests__/agents-heartbeat-cadence-read.test.ts
git commit -m "feat(routes): expose idle streak + effective heartbeat interval on agents"
```

---

## Task 8: UI readout + config controls

**Files:**
- Modify: `ui/src/api/agents.ts` (add `heartbeatIdleStreak`, `effectiveHeartbeatIntervalSec` to the agent API type)
- Modify: the agent settings surface (heartbeat controls) to add enable / multiplier / max-interval inputs bound to `runtimeConfig.heartbeat.idleBackoff`
- Modify: the agent status/row surface to render the cadence readout
- Test: co-located component test for the readout

**Interfaces:**
- Consumes: `heartbeatIdleStreak`, `effectiveHeartbeatIntervalSec` from the agent API type

- [ ] **Step 1: Write the failing readout test**

Add a component test asserting the readout renders `idle ×N → <human interval>` when `heartbeatIdleStreak > 0` and backoff is enabled, and renders the plain configured interval otherwise. Follow the existing `AdmissionStatusLine.test.tsx` pattern for rendering + assertions.

```ts
it("shows the backed-off cadence when idle", () => {
  render(<AgentCadenceReadout heartbeatIdleStreak={6} effectiveHeartbeatIntervalSec={1800} enabled intervalSec={300} />);
  expect(screen.getByText(/idle ×6/)).toBeInTheDocument();
  expect(screen.getByText(/30m/)).toBeInTheDocument();
});

it("shows the plain interval when not backed off", () => {
  render(<AgentCadenceReadout heartbeatIdleStreak={0} effectiveHeartbeatIntervalSec={300} enabled intervalSec={300} />);
  expect(screen.queryByText(/idle ×/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ui exec vitest run` (scoped to the new test file)
Expected: FAIL — component not defined.

- [ ] **Step 3: Add the API type fields**

In `ui/src/api/agents.ts`, add to the agent type:

```ts
  heartbeatIdleStreak: number;
  effectiveHeartbeatIntervalSec: number;
```

- [ ] **Step 4: Implement the readout component**

Create the small `AgentCadenceReadout` component. When `enabled && heartbeatIdleStreak > 0`, render `idle ×{streak} → {formatDuration(effectiveHeartbeatIntervalSec)}`; otherwise render `{formatDuration(intervalSec)}`. Reuse an existing duration formatter if the codebase has one (grep `formatDuration`/`humanizeSeconds`); otherwise a minimal `m`/`h` formatter.

- [ ] **Step 5: Add the config controls**

On the agent settings heartbeat section, add: an "Idle backoff" toggle (`idleBackoff.enabled`), a multiplier number input (min 1.1, step 0.5, default 2), and a max-interval input (in minutes, mapped to `maxIntervalSec`). Persist under `runtimeConfig.heartbeat.idleBackoff`, mirroring how the existing `intervalSec` control writes `runtimeConfig.heartbeat`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter ui exec vitest run` (scoped to the new test file)
Expected: PASS.

Run: `pnpm --filter ui run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/src/api/agents.ts ui/src/components ui/src/pages
git commit -m "feat(ui): agent idle-backoff controls + cadence readout"
```

---

## Final verification

- [ ] **Step 1: Full typecheck across touched packages**

Run: `pnpm --filter @paperclipai/db --filter @paperclipai/shared --filter server --filter ui run typecheck`
Expected: PASS.

- [ ] **Step 2: Run the full server + shared + ui test suites**

Run: `pnpm --filter @paperclipai/shared --filter server --filter ui exec vitest run`
Expected: PASS.

- [ ] **Step 3: Confirm disabled-path parity**

Manually re-read the `tickTimers` diff: with `idleBackoff.enabled === false`, `effectiveIntervalSec` returns `policy.intervalSec`, so the gate is byte-for-byte equivalent to the previous `policy.intervalSec * 1000` check. No behavior change for agents that haven't opted in.
```

## Notes / deviations from the spec

- **Event-wake reset folded into the completion rule.** The spec's transition table lists a separate "event wake → reset" at `enqueueWakeup` time. This plan omits that write: event-driven runs reset the streak when they *complete* (any non-empty completion resets), and event wakes never consult the streak (they bypass the timer gate), so a separate enqueue-time reset is redundant for both correctness and responsiveness. This avoids threading state into `enqueueWakeup`'s many branches. Net behavior matches the spec's intent.
