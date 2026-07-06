# Combo-01 Phase 1 Instance-Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce an instance-wide agent-run concurrency ceiling through a single admission choke point, resolved via a precedence-ordered cap registry, that is a no-op until an operator sets it.

**Architecture:** A pure `effective-cap-resolver` reduces cap writers to one number by fixed precedence (Phase 1 ships one writer: `configured-default`, reading a new `maxConcurrentRuns` instance setting). The existing per-agent claim loop in `startNextQueuedRunForAgent` gains an inner instance-scoped async lock; inside it we recompute the instance-wide running count from the DB (ground truth) and cap the number of runs claimed this tick at `min(perAgentSlots, instanceSlots)`.

**Tech Stack:** TypeScript, Drizzle ORM, Zod (`@paperclipai/shared`), Vitest, embedded Postgres test harness (`server/src/__tests__/helpers/embedded-postgres.ts`).

## Global Constraints

- No new run status: cap-deferred runs stay `status="queued"` and are re-evaluated next tick.
- Unset cap ⇒ unlimited ⇒ behavior byte-identical to today. This is non-negotiable and has a dedicated regression test.
- Fail-open: any resolver/settings/COUNT error falls back to `cap = null` (per-agent-only). The gate must never take down run execution.
- Follow existing file conventions; every new/changed source file must carry the `// [START: module]`/`// [END: module]` nav tags (run `python3 scripts/nav/nav_endhook.py` before the final commit).
- Recovery/scheduled-retry paths must NOT be modified — they already re-enter via `status="queued"`.

## File Structure

- Create `server/src/services/effective-cap-resolver.ts` — pure cap registry + resolution (no DB, no I/O).
- Create `server/src/services/effective-cap-resolver.test.ts` — resolver unit tests.
- Create `server/src/services/instance-admission-lock.ts` — instance-scoped async mutex (mirrors `agent-start-lock.ts`).
- Create `server/src/services/instance-admission-lock.test.ts` — lock serialization tests.
- Modify `packages/shared/src/validators/instance.ts:41` — add optional `maxConcurrentRuns` to the general settings schema.
- Modify `server/src/services/instance-settings.ts:36` — carry `maxConcurrentRuns` through `normalizeGeneralSettings`.
- Modify `server/src/services/heartbeat.ts` — add `countRunningRunsInstanceWide`; gate the claim loop in `startNextQueuedRunForAgent` (8194–8269).
- Create `server/src/__tests__/heartbeat-instance-admission.test.ts` — admission integration tests.

---

### Task 1: Effective-cap resolver (pure registry)

**Files:**
- Create: `server/src/services/effective-cap-resolver.ts`
- Test: `server/src/services/effective-cap-resolver.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type CapContext = { instanceMaxConcurrentRuns: number | null }`
  - `type CapWriter = { name: string; precedence: number; resolve(ctx: CapContext): number | null }`
  - `const CAP_WRITER_PRECEDENCE: readonly string[]` — locked order.
  - `function resolveEffectiveCap(ctx: CapContext, writers: CapWriter[]): { cap: number | null; source: string }`
  - `const configuredDefaultWriter: CapWriter`
  - `const PHASE1_WRITERS: CapWriter[]` (just `[configuredDefaultWriter]`).

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/services/effective-cap-resolver.test.ts
import { describe, expect, it } from "vitest";
import {
  CAP_WRITER_PRECEDENCE,
  PHASE1_WRITERS,
  configuredDefaultWriter,
  resolveEffectiveCap,
  type CapWriter,
} from "./effective-cap-resolver.js";

describe("effective-cap-resolver", () => {
  it("locks the precedence order so future writers cannot reorder it", () => {
    expect(CAP_WRITER_PRECEDENCE).toEqual([
      "panic-drain",
      "predictive-breaker",
      "manual-override",
      "schedule",
      "configured-default",
    ]);
  });

  it("returns the first non-null writer by precedence", () => {
    const writers: CapWriter[] = [
      { name: "configured-default", precedence: 4, resolve: () => 10 },
      { name: "manual-override", precedence: 2, resolve: () => 3 },
    ];
    const { cap, source } = resolveEffectiveCap({ instanceMaxConcurrentRuns: 10 }, writers);
    expect(cap).toBe(3);
    expect(source).toBe("manual-override");
  });

  it("skips writers that return null (no opinion)", () => {
    const writers: CapWriter[] = [
      { name: "manual-override", precedence: 2, resolve: () => null },
      { name: "configured-default", precedence: 4, resolve: () => 7 },
    ];
    expect(resolveEffectiveCap({ instanceMaxConcurrentRuns: 7 }, writers).cap).toBe(7);
  });

  it("yields unlimited (null) when no writer has an opinion", () => {
    const { cap, source } = resolveEffectiveCap({ instanceMaxConcurrentRuns: null }, PHASE1_WRITERS);
    expect(cap).toBeNull();
    expect(source).toBe("none");
  });

  it("configured-default writer echoes the instance setting", () => {
    expect(configuredDefaultWriter.resolve({ instanceMaxConcurrentRuns: 5 })).toBe(5);
    expect(configuredDefaultWriter.resolve({ instanceMaxConcurrentRuns: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/services/effective-cap-resolver.test.ts`
Expected: FAIL — cannot find module `./effective-cap-resolver.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/src/services/effective-cap-resolver.ts
/**
 * FILE: server/src/services/effective-cap-resolver.ts
 * ABOUT: effective-cap-resolver.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - effective-cap-resolver.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: effective-cap-resolver.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/effective-cap-resolver.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]

// Locked precedence order (highest priority first). Later combo-01 slices
// register writers at these names; a unit test asserts this array so nothing
// can silently reorder it.
export const CAP_WRITER_PRECEDENCE = [
  "panic-drain",
  "predictive-breaker",
  "manual-override",
  "schedule",
  "configured-default",
] as const;

export type CapContext = { instanceMaxConcurrentRuns: number | null };

export type CapWriter = {
  name: string;
  precedence: number; // lower = higher priority
  resolve(ctx: CapContext): number | null; // null = "no opinion"
};

export const configuredDefaultWriter: CapWriter = {
  name: "configured-default",
  precedence: CAP_WRITER_PRECEDENCE.indexOf("configured-default"),
  resolve: (ctx) => ctx.instanceMaxConcurrentRuns,
};

export const PHASE1_WRITERS: CapWriter[] = [configuredDefaultWriter];

// First non-null writer by ascending precedence wins. null cap = unlimited.
export function resolveEffectiveCap(
  ctx: CapContext,
  writers: CapWriter[],
): { cap: number | null; source: string } {
  const ordered = [...writers].sort((a, b) => a.precedence - b.precedence);
  for (const writer of ordered) {
    const value = writer.resolve(ctx);
    if (value !== null) return { cap: value, source: writer.name };
  }
  return { cap: null, source: "none" };
}
// [END: module]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/services/effective-cap-resolver.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/effective-cap-resolver.ts server/src/services/effective-cap-resolver.test.ts
git commit -m "feat(admission): effective-cap resolver with locked precedence"
```

---

### Task 2: `maxConcurrentRuns` instance setting

**Files:**
- Modify: `packages/shared/src/validators/instance.ts:41-53`
- Modify: `server/src/services/instance-settings.ts:36-55`
- Test: `server/src/__tests__/instance-settings-service.test.ts` (existing file — add a case)

**Interfaces:**
- Consumes: nothing.
- Produces: `InstanceGeneralSettings.maxConcurrentRuns?: number` available via `instanceSettingsService(db).getGeneral()`.

- [ ] **Step 1: Write the failing test** (append to the existing describe block)

```typescript
// server/src/__tests__/instance-settings-service.test.ts
it("persists and reads back maxConcurrentRuns", async () => {
  const svc = instanceSettingsService(db);
  await svc.updateGeneral({ maxConcurrentRuns: 10 });
  expect((await svc.getGeneral()).maxConcurrentRuns).toBe(10);
});

it("omits maxConcurrentRuns when unset (unlimited)", async () => {
  const svc = instanceSettingsService(db);
  expect((await svc.getGeneral()).maxConcurrentRuns).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/instance-settings-service.test.ts -t maxConcurrentRuns`
Expected: FAIL — `maxConcurrentRuns` not persisted (schema strips it).

- [ ] **Step 3a: Add the field to the shared schema**

In `packages/shared/src/validators/instance.ts`, inside `instanceGeneralSettingsSchema = z.object({ ... })` (line 41), add next to `executionMode`:

```typescript
  maxConcurrentRuns: z.number().int().positive().optional(),
```

- [ ] **Step 3b: Carry it through normalization**

In `server/src/services/instance-settings.ts`, inside `normalizeGeneralSettings`, in the `parsed.success` return object, add after the `executionMode` spread (following the same "absent ⇒ omit" pattern):

```typescript
      // Absent => unlimited; only carry through an explicit cap.
      ...(parsed.data.maxConcurrentRuns ? { maxConcurrentRuns: parsed.data.maxConcurrentRuns } : {}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/instance-settings-service.test.ts -t maxConcurrentRuns`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/validators/instance.ts server/src/services/instance-settings.ts server/src/__tests__/instance-settings-service.test.ts
git commit -m "feat(admission): add maxConcurrentRuns instance setting"
```

---

### Task 3: Instance admission lock

**Files:**
- Create: `server/src/services/instance-admission-lock.ts`
- Test: `server/src/services/instance-admission-lock.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function withInstanceAdmissionLock<T>(fn: () => Promise<T>): Promise<T>` — a single global mutex; concurrent calls run strictly one at a time in FIFO order.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/services/instance-admission-lock.test.ts
import { describe, expect, it } from "vitest";
import { withInstanceAdmissionLock } from "./instance-admission-lock.js";

describe("withInstanceAdmissionLock", () => {
  it("serializes critical sections (no interleaving)", async () => {
    const events: string[] = [];
    const critical = (id: string) =>
      withInstanceAdmissionLock(async () => {
        events.push(`enter-${id}`);
        await new Promise((r) => setTimeout(r, 5));
        events.push(`exit-${id}`);
      });
    await Promise.all([critical("a"), critical("b")]);
    // Each enter is immediately followed by its own exit — no interleave.
    expect(events).toEqual(["enter-a", "exit-a", "enter-b", "exit-b"]);
  });

  it("releases the lock even when fn throws", async () => {
    await expect(
      withInstanceAdmissionLock(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Lock is free again:
    await expect(withInstanceAdmissionLock(async () => "ok")).resolves.toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/instance-admission-lock.test.ts`
Expected: FAIL — cannot find module `./instance-admission-lock.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/src/services/instance-admission-lock.ts
/**
 * FILE: server/src/services/instance-admission-lock.ts
 * ABOUT: instance-admission-lock.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - instance-admission-lock.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: instance-admission-lock.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/instance-admission-lock.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]

// Single global mutex for the run-admission critical section. In-memory,
// single-process — same class as agent-start-lock.ts. The chain guarantees
// FIFO, non-interleaved execution of the count+claim step across agents.
let tail: Promise<unknown> = Promise.resolve();

export async function withInstanceAdmissionLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  // Keep the chain alive regardless of success/failure so a throw never
  // wedges the lock.
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
// [END: module]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/services/instance-admission-lock.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/instance-admission-lock.ts server/src/services/instance-admission-lock.test.ts
git commit -m "feat(admission): instance-scoped admission lock"
```

---

### Task 4: Instance-wide running count + resolver wiring

**Files:**
- Modify: `server/src/services/heartbeat.ts` (add `countRunningRunsInstanceWide` near `countRunningRunsForAgent`, ~7238)
- Test: `server/src/__tests__/heartbeat-instance-admission.test.ts` (new; count-only test in this task)

**Interfaces:**
- Consumes: `heartbeatRuns` table; `resolveEffectiveCap`, `PHASE1_WRITERS` (Task 1); `instanceSettingsService(...).getGeneral()` (Task 2).
- Produces: `async function countRunningRunsInstanceWide(): Promise<number>` (module-local in heartbeat.ts) counting all `heartbeatRuns` with `status="running"`.

- [ ] **Step 1: Write the failing test**

Mirror the DB bootstrap (imports, `createDb`, `beforeAll`/`afterAll`, company+agent creation helpers) from `server/src/__tests__/heartbeat-dependency-scheduling.test.ts`. Then:

```typescript
// server/src/__tests__/heartbeat-instance-admission.test.ts  (count portion)
it("counts running runs across all agents in the instance", async () => {
  // Seed two agents in one company, insert 3 running + 1 queued heartbeatRuns.
  // (use the same insert helpers as the mirrored test file)
  const svc = createHeartbeatService(db /* + same deps as existing tests */);
  expect(await svc._test_countRunningRunsInstanceWide()).toBe(3);
});
```

> The heartbeat service closes over its helpers. Expose `countRunningRunsInstanceWide` on the returned service object under a `_test_` prefix (matching how existing tests reach internal helpers — grep `_test_` in `heartbeat.ts` for the established convention; if none exists, export it on the service object as `countRunningRunsInstanceWide`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts -t "counts running"`
Expected: FAIL — method undefined.

- [ ] **Step 3: Implement the count helper**

In `server/src/services/heartbeat.ts`, immediately after `countRunningRunsForAgent` (ends ~7244), add:

```typescript
  async function countRunningRunsInstanceWide() {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.status, "running"));
    return Number(count ?? 0);
  }
```

Expose it on the returned service object (add `countRunningRunsInstanceWide,` to the object literal the service returns) so the test can call it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts -t "counts running"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/heartbeat-instance-admission.test.ts
git commit -m "feat(admission): instance-wide running-run count"
```

---

### Task 5: Gate the admission seam

**Files:**
- Modify: `server/src/services/heartbeat.ts:8194-8269` (`startNextQueuedRunForAgent`)
- Test: `server/src/__tests__/heartbeat-instance-admission.test.ts` (add the admission cases)

**Interfaces:**
- Consumes: `withInstanceAdmissionLock` (Task 3); `countRunningRunsInstanceWide` (Task 4); `resolveEffectiveCap`, `PHASE1_WRITERS` (Task 1); `instanceSettingsService` (Task 2).
- Produces: gated claim loop — runs claimed per tick ≤ `min(perAgentSlots, instanceSlots)`.

- [ ] **Step 1: Add imports** at the top of `heartbeat.ts` (with the other `./` service imports)

```typescript
import { withInstanceAdmissionLock } from "./instance-admission-lock.js";
import { resolveEffectiveCap, PHASE1_WRITERS } from "./effective-cap-resolver.js";
```

- [ ] **Step 2: Write the failing tests**

Add to `heartbeat-instance-admission.test.ts` (reuse the mirrored bootstrap; assume a helper `saturateQueue(companyId, agentIds, perAgent)` that inserts many `queued` runs, and `runTickForAllAgents()` that calls `startNextQueuedRunForAgent` for each agent):

```typescript
it("never exceeds the instance cap under saturation (exit criterion)", async () => {
  await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });
  const agentIds = await createAgents(companyId, 30, { maxConcurrentRuns: 20 });
  await saturateQueue(companyId, agentIds, 20);
  for (let tick = 0; tick < 5; tick++) {
    await runTickForAllAgents(agentIds);
    const running = await countRunning(db); // count status="running"
    expect(running).toBeLessThanOrEqual(10);
  }
});

it("is a no-op when the cap is unset (behavior identical to today)", async () => {
  // no updateGeneral call → unlimited
  const agentIds = await createAgents(companyId, 3, { maxConcurrentRuns: 2 });
  await saturateQueue(companyId, agentIds, 5);
  await runTickForAllAgents(agentIds);
  // Each agent still claims exactly its per-agent cap (2), unbounded by any instance cap.
  expect(await countRunning(db)).toBe(6);
});

it("binds on the tighter of per-agent and instance caps", async () => {
  await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });
  const [agentId] = await createAgents(companyId, 1, { maxConcurrentRuns: 2 });
  await saturateQueue(companyId, [agentId], 5);
  await runTickForAllAgents([agentId]);
  expect(await countRunning(db)).toBe(2); // per-agent cap still binds
});

it("falls back to per-agent-only when the cap lookup throws (fail-open)", async () => {
  const spy = vi.spyOn(instanceSettingsService(db), "getGeneral").mockRejectedValue(new Error("db blip"));
  const agentIds = await createAgents(companyId, 2, { maxConcurrentRuns: 2 });
  await saturateQueue(companyId, agentIds, 5);
  await runTickForAllAgents(agentIds);
  expect(await countRunning(db)).toBe(4); // runs still start
  spy.mockRestore();
});

it("under-admits (never breaches) when running rows are leaked", async () => {
  await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });
  await seedOrphanRunningRows(companyId, 10); // simulate a crash leak
  const agentIds = await createAgents(companyId, 3, { maxConcurrentRuns: 20 });
  await saturateQueue(companyId, agentIds, 20);
  await runTickForAllAgents(agentIds);
  expect(await countRunning(db)).toBe(10); // 0 new admitted; never > cap
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts`
Expected: the four new cases FAIL (instance cap not enforced) except the no-op case, which may already pass.

- [ ] **Step 4: Implement the gate**

Replace the claim loop (currently 8255–8260) so it runs inside the admission lock with the effective-cap budget. The block after `prioritizedRuns` is built becomes:

```typescript
      const claimedRuns: Array<typeof heartbeatRuns.$inferSelect> = [];
      await withInstanceAdmissionLock(async () => {
        let instanceSlots = availableSlots; // start from the per-agent budget
        try {
          const general = await instanceSettingsService(db).getGeneral();
          const { cap } = resolveEffectiveCap(
            { instanceMaxConcurrentRuns: general.maxConcurrentRuns ?? null },
            PHASE1_WRITERS,
          );
          if (cap !== null) {
            const running = await countRunningRunsInstanceWide();
            instanceSlots = Math.min(availableSlots, Math.max(0, cap - running));
          }
        } catch (err) {
          logger.warn({ err }, "instance admission cap lookup failed; falling back to per-agent only");
          instanceSlots = availableSlots;
        }
        for (const queuedRun of prioritizedRuns) {
          if (claimedRuns.length >= instanceSlots) break;
          const claimed = await claimQueuedRun(queuedRun, companyAgents);
          if (claimed) claimedRuns.push(claimed); // claim flips queued→running atomically
        }
      });
      if (claimedRuns.length === 0) return [];
```

(The existing `void executeRun(...)` loop at 8263–8267 stays exactly as-is, after the lock.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Run the broader heartbeat suite (no regressions)**

Run: `cd server && npx vitest run src/__tests__/heartbeat-dependency-scheduling.test.ts src/__tests__/heartbeat-retry-scheduling.test.ts`
Expected: PASS (proves recovery/retry paths still work through the gated seam).

- [ ] **Step 7: Sync nav + commit**

```bash
python3 scripts/nav/nav_endhook.py
git add server/src/services/heartbeat.ts server/src/__tests__/heartbeat-instance-admission.test.ts nav/
git commit -m "feat(admission): gate run-start on instance-wide concurrency cap"
```

---

## Self-review notes

- **Spec coverage:** resolver+precedence (Task 1), setting+unset-default (Task 2), lock (Task 3), instance count (Task 4), seam gate + all six spec tests — exit criterion, no-op, min(perAgent,instance), cross-agent serialization (covered by the saturation test running many agents through the single lock), fail-open, leaked-running (Task 5). Cross-agent serialization is additionally unit-tested in Task 3.
- **Deferred items** (per-company cap, manual-override writer, pluggable selectNextRun, reconciler, UI, `queued_admission`) are intentionally absent.
- **Recovery/retry** code is untouched, per Global Constraints.
