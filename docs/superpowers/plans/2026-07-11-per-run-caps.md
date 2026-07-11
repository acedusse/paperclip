# Per-Run Resource Caps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce per-run `maxRunWallClockMs` and `maxRunCostCents` ceilings — configured on instance + company, stamped onto each run at claim, enforced by winding the run down (resumable) via the merged `windDownRun`.

**Architecture:** Cap values resolve `company ?? instance` and are frozen onto the `heartbeat_runs` row at claim. Cost is enforced reactively after each cost event; wall-clock (and a cost backstop) run in a new `run-cap-sweep` reconcile source in the Phase-1 loop. A pure, injected `run-caps.ts` module holds the logic; heartbeat/costs wire concrete deps.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Zod, Vitest, React (UI). Design spec: `docs/superpowers/specs/2026-07-11-per-run-caps-design.md`.

## Global Constraints

- Migrations are **hand-written** (`drizzle-kit generate` is unusable in this repo — schema drift past `0098`). Next number is `0108`. Add `.sql` + a `_journal.json` entry. (spec: Schema changes)
- **Instance** cap values live inside the `instance_settings.general` JSONB (added to `instanceGeneralSettingsSchema` AND carried through `normalizeGeneralSettings`, else `.strip()` drops them). **Company** cap values are real integer columns. (spec: Config storage)
- Resolution is `company ?? instance ?? null`; null = unlimited. **Not** the `PHASE1_WRITERS` registry. (spec: Design decision 2)
- Both cap types wind down with `windDownRun(runId, { mode: "hard", resume: "when-allowed", reason })`, `reason` = `"cap-wallclock"` or `"cap-cost"` (already in `WindDownReason`). (spec: Design decision 4)
- The `run-cap-sweep` reconcile source is the crash-safe backstop for BOTH caps; reactive cost enforcement is an optimization on the primary cost-record path. (spec: Enforcement wiring)
- Follow the injected-deps + fake-deps-unit-test pattern of `run-wind-down.ts` / `admission-reconciler.ts`.
- Run tests: `cd server && npx vitest run <path>`. Build db: `pnpm --filter @paperclipai/db build`. Typecheck server: `cd server && pnpm typecheck`.

---

### Task 1: Schema — cap columns on `companies` + `heartbeat_runs`, migration 0108

**Files:**
- Modify: `packages/db/src/schema/companies.ts:30`
- Modify: `packages/db/src/schema/heartbeat_runs.ts`
- Create: `packages/db/src/migrations/0108_per_run_caps.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `companies.maxRunWallClockMs`, `companies.maxRunCostCents`, `heartbeatRuns.maxRunWallClockMs`, `heartbeatRuns.maxRunCostCents` (all nullable integers) on the Drizzle tables.

- [ ] **Step 1: Add company columns**

In `packages/db/src/schema/companies.ts`, after `maxConcurrentRuns: integer("max_concurrent_runs"),`:

```ts
    // Combo-01 Phase 2a per-run ceilings (company override; null = unset).
    maxRunWallClockMs: integer("max_run_wall_clock_ms"),
    maxRunCostCents: integer("max_run_cost_cents"),
```

- [ ] **Step 2: Add stamped run columns**

In `packages/db/src/schema/heartbeat_runs.ts`, after the `resumePolicy` column (added by Phase 2.0):

```ts
    // Combo-01 Phase 2a: effective per-run ceilings, stamped at claim from
    // company ?? instance config. Null = unlimited. Enforcement reads these,
    // not live config.
    maxRunWallClockMs: integer("max_run_wall_clock_ms"),
    maxRunCostCents: integer("max_run_cost_cents"),
```

- [ ] **Step 3: Write the migration**

Create `packages/db/src/migrations/0108_per_run_caps.sql`:

```sql
ALTER TABLE "companies" ADD COLUMN "max_run_wall_clock_ms" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "max_run_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "max_run_wall_clock_ms" integer;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "max_run_cost_cents" integer;
```

- [ ] **Step 4: Add the journal entry**

In `packages/db/src/migrations/meta/_journal.json`, append after the `0107_wind_down_run_fields` entry (mind the comma on the prior entry's closing brace):

```json
    {
      "idx": 108,
      "version": "7",
      "when": 1781902300000,
      "tag": "0108_per_run_caps",
      "breakpoints": true
    }
```

- [ ] **Step 5: Build the db package**

Run: `pnpm --filter @paperclipai/db build`
Expected: PASS (`check:migrations` clean, tsc compiles, migrations copied).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/companies.ts packages/db/src/schema/heartbeat_runs.ts packages/db/src/migrations/
git commit -m "feat(db): add per-run wall-clock and cost cap columns"
```

---

### Task 2: Shared config — validators, types, instance normalize carry-through

**Files:**
- Modify: `packages/shared/src/validators/instance.ts:51`
- Modify: `packages/shared/src/types/instance.ts:63`
- Modify: `packages/shared/src/validators/company.ts:52`
- Modify: `packages/shared/src/types/company.ts:29`
- Modify: `server/src/services/instance-settings.ts:48`
- Test: `server/src/__tests__/instance-settings-run-caps.test.ts` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `maxRunWallClockMs` / `maxRunCostCents` accepted + persisted on instance `general` and company update; present on `InstanceGeneralSettings` and company types.

- [ ] **Step 1: Extend the instance general Zod schema**

In `packages/shared/src/validators/instance.ts`, inside `instanceGeneralSettingsSchema` after `maxConcurrentRuns:`:

```ts
  maxRunWallClockMs: z.number().int().positive().nullable().optional(),
  maxRunCostCents: z.number().int().positive().nullable().optional(),
```

- [ ] **Step 2: Extend the instance type mirror**

In `packages/shared/src/types/instance.ts`, in the instance general settings type near `maxConcurrentRuns?: number`:

```ts
  maxRunWallClockMs?: number | null;
  maxRunCostCents?: number | null;
```

- [ ] **Step 3: Extend the company update validator + type**

In `packages/shared/src/validators/company.ts`, inside `updateCompanySchema.extend({...})` near `maxConcurrentRuns`:

```ts
    maxRunWallClockMs: z.number().int().positive().nullable().optional(),
    maxRunCostCents: z.number().int().positive().nullable().optional(),
```

In `packages/shared/src/types/company.ts` near `maxConcurrentRuns?: number | null`:

```ts
  maxRunWallClockMs?: number | null;
  maxRunCostCents?: number | null;
```

- [ ] **Step 4: Carry the fields through `normalizeGeneralSettings`**

In `server/src/services/instance-settings.ts`, inside the success branch of `normalizeGeneralSettings` (after the `maxConcurrentRuns` spread at `:48`):

```ts
      // Absent => unlimited; only carry through an explicit cap.
      ...(parsed.data.maxRunWallClockMs ? { maxRunWallClockMs: parsed.data.maxRunWallClockMs } : {}),
      ...(parsed.data.maxRunCostCents ? { maxRunCostCents: parsed.data.maxRunCostCents } : {}),
```

- [ ] **Step 5: Write the round-trip test (guards the `.strip()` drop)**

Create `server/src/__tests__/instance-settings-run-caps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { instanceGeneralSettingsSchema } from "@paperclipai/shared";

describe("instance general settings — per-run caps", () => {
  it("accepts and preserves the two per-run cap fields", () => {
    const parsed = instanceGeneralSettingsSchema.parse({
      maxRunWallClockMs: 600000,
      maxRunCostCents: 500,
    });
    expect(parsed.maxRunWallClockMs).toBe(600000);
    expect(parsed.maxRunCostCents).toBe(500);
  });

  it("rejects non-positive cap values", () => {
    expect(() => instanceGeneralSettingsSchema.parse({ maxRunCostCents: 0 })).toThrow();
    expect(() => instanceGeneralSettingsSchema.parse({ maxRunWallClockMs: -1 })).toThrow();
  });
});
```

- [ ] **Step 6: Run the test**

Run: `cd server && npx vitest run src/__tests__/instance-settings-run-caps.test.ts`
Expected: PASS (2 tests). (If `instanceGeneralSettingsSchema` is not re-exported from `@paperclipai/shared`, import from `@paperclipai/shared/validators/instance` — check the package's export map.)

- [ ] **Step 7: Typecheck + commit**

Run: `cd server && pnpm typecheck` → PASS.

```bash
git add packages/shared/src server/src/services/instance-settings.ts server/src/__tests__/instance-settings-run-caps.test.ts
git commit -m "feat(config): accept per-run wall-clock and cost caps on instance + company"
```

---

### Task 3: `run-caps.ts` pure module + fake-deps unit tests

**Files:**
- Create: `server/src/services/run-caps.ts`
- Create: `server/src/services/run-caps.test.ts`

**Interfaces:**
- Consumes: `ReconcileResult`, `ReconcileSource` from `./admission-reconciler.js`.
- Produces:
  - `type RunCaps = { maxRunWallClockMs: number | null; maxRunCostCents: number | null }`
  - `type RunCapReason = "cap-wallclock" | "cap-cost"`
  - `type RunCapViolation = { runId: string; reason: RunCapReason }`
  - `type RunningRunCapRow = { id: string; startedAt: Date | null; maxRunWallClockMs: number | null; maxRunCostCents: number | null }`
  - `function resolveRunCaps(input: { company: RunCaps; instance: RunCaps }): RunCaps`
  - `function isWallClockExceeded(row: RunningRunCapRow, now: Date): boolean`
  - `type RunCostCapDeps = { getStampedCostCap(runId: string): Promise<number | null>; sumRunCostCents(runId: string): Promise<number> }`
  - `async function evaluateRunCostCap(deps: RunCostCapDeps, runId: string): Promise<RunCapViolation | null>`
  - `type RunCapSweepDeps = { findRunningRunsWithCaps(): Promise<RunningRunCapRow[]>; sumRunCostCents(runId: string): Promise<number>; windDownRun(runId: string, opts: { mode: "hard"; resume: "when-allowed"; reason: RunCapReason }): Promise<unknown> }`
  - `function makeRunCapSweepSource(deps: RunCapSweepDeps): ReconcileSource` — name `"run-cap-sweep"`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/services/run-caps.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  evaluateRunCostCap,
  isWallClockExceeded,
  makeRunCapSweepSource,
  resolveRunCaps,
  type RunningRunCapRow,
} from "./run-caps.js";

describe("resolveRunCaps", () => {
  it("company overrides instance per field", () => {
    expect(
      resolveRunCaps({
        company: { maxRunWallClockMs: 1000, maxRunCostCents: null },
        instance: { maxRunWallClockMs: 9999, maxRunCostCents: 500 },
      }),
    ).toEqual({ maxRunWallClockMs: 1000, maxRunCostCents: 500 });
  });

  it("both null => unlimited", () => {
    expect(
      resolveRunCaps({
        company: { maxRunWallClockMs: null, maxRunCostCents: null },
        instance: { maxRunWallClockMs: null, maxRunCostCents: null },
      }),
    ).toEqual({ maxRunWallClockMs: null, maxRunCostCents: null });
  });
});

describe("isWallClockExceeded", () => {
  const base: RunningRunCapRow = { id: "r", startedAt: new Date("2026-07-11T00:00:00Z"), maxRunWallClockMs: 60000, maxRunCostCents: null };
  it("true when elapsed exceeds the cap", () => {
    expect(isWallClockExceeded(base, new Date("2026-07-11T00:01:01Z"))).toBe(true);
  });
  it("false when within the cap", () => {
    expect(isWallClockExceeded(base, new Date("2026-07-11T00:00:30Z"))).toBe(false);
  });
  it("false when no cap or no startedAt", () => {
    expect(isWallClockExceeded({ ...base, maxRunWallClockMs: null }, new Date())).toBe(false);
    expect(isWallClockExceeded({ ...base, startedAt: null }, new Date())).toBe(false);
  });
});

describe("evaluateRunCostCap", () => {
  it("violation when spend exceeds the stamped cap", async () => {
    const deps = { getStampedCostCap: vi.fn(async () => 500), sumRunCostCents: vi.fn(async () => 501) };
    expect(await evaluateRunCostCap(deps, "r1")).toEqual({ runId: "r1", reason: "cap-cost" });
  });
  it("null when within the cap", async () => {
    const deps = { getStampedCostCap: vi.fn(async () => 500), sumRunCostCents: vi.fn(async () => 500) };
    expect(await evaluateRunCostCap(deps, "r1")).toBeNull();
  });
  it("null (and no sum query) when the cap is unset", async () => {
    const sumRunCostCents = vi.fn(async () => 9999);
    expect(await evaluateRunCostCap({ getStampedCostCap: vi.fn(async () => null), sumRunCostCents }, "r1")).toBeNull();
    expect(sumRunCostCents).not.toHaveBeenCalled();
  });
});

describe("makeRunCapSweepSource", () => {
  const now = new Date("2026-07-11T01:00:00Z");
  it("winds down a wall-clock violator with cap-wallclock", async () => {
    const rows: RunningRunCapRow[] = [
      { id: "old", startedAt: new Date("2026-07-11T00:00:00Z"), maxRunWallClockMs: 60000, maxRunCostCents: null },
    ];
    const windDownRun = vi.fn(async () => ({ outcome: "terminated" }));
    const source = makeRunCapSweepSource({
      findRunningRunsWithCaps: vi.fn(async () => rows),
      sumRunCostCents: vi.fn(async () => 0),
      windDownRun,
    });
    const result = await source.reconcile(now);
    expect(windDownRun).toHaveBeenCalledWith("old", { mode: "hard", resume: "when-allowed", reason: "cap-wallclock" });
    expect(result).toEqual({ source: "run-cap-sweep", drifted: 1, repaired: 1 });
  });

  it("winds down a cost violator with cap-cost when wall-clock is fine", async () => {
    const rows: RunningRunCapRow[] = [
      { id: "spendy", startedAt: now, maxRunWallClockMs: null, maxRunCostCents: 100 },
    ];
    const windDownRun = vi.fn(async () => ({ outcome: "terminated" }));
    const source = makeRunCapSweepSource({
      findRunningRunsWithCaps: vi.fn(async () => rows),
      sumRunCostCents: vi.fn(async () => 150),
      windDownRun,
    });
    const result = await source.reconcile(now);
    expect(windDownRun).toHaveBeenCalledWith("spendy", { mode: "hard", resume: "when-allowed", reason: "cap-cost" });
    expect(result).toEqual({ source: "run-cap-sweep", drifted: 1, repaired: 1 });
  });

  it("leaves compliant runs alone", async () => {
    const rows: RunningRunCapRow[] = [{ id: "ok", startedAt: now, maxRunWallClockMs: 60000, maxRunCostCents: 100 }];
    const windDownRun = vi.fn(async () => ({ outcome: "terminated" }));
    const source = makeRunCapSweepSource({
      findRunningRunsWithCaps: vi.fn(async () => rows),
      sumRunCostCents: vi.fn(async () => 10),
      windDownRun,
    });
    expect(await source.reconcile(now)).toEqual({ source: "run-cap-sweep", drifted: 0, repaired: 0 });
    expect(windDownRun).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run src/services/run-caps.test.ts`
Expected: FAIL — cannot resolve `./run-caps.js`.

- [ ] **Step 3: Write the module**

Create `server/src/services/run-caps.ts`:

```ts
// Combo-01 Phase 2a: per-run resource-cap logic. Pure + dependency-injected,
// like run-wind-down.ts. Enforcement terminates via the injected windDownRun.
import type { ReconcileResult, ReconcileSource } from "./admission-reconciler.js";

export type RunCaps = { maxRunWallClockMs: number | null; maxRunCostCents: number | null };
export type RunCapReason = "cap-wallclock" | "cap-cost";
export type RunCapViolation = { runId: string; reason: RunCapReason };

// A running run with its stamped ceilings + wall-clock baseline.
export type RunningRunCapRow = {
  id: string;
  startedAt: Date | null;
  maxRunWallClockMs: number | null;
  maxRunCostCents: number | null;
};

// company overrides instance, per field. null = unlimited.
export function resolveRunCaps(input: { company: RunCaps; instance: RunCaps }): RunCaps {
  return {
    maxRunWallClockMs: input.company.maxRunWallClockMs ?? input.instance.maxRunWallClockMs,
    maxRunCostCents: input.company.maxRunCostCents ?? input.instance.maxRunCostCents,
  };
}

export function isWallClockExceeded(row: RunningRunCapRow, now: Date): boolean {
  if (row.maxRunWallClockMs == null || !row.startedAt) return false;
  return now.getTime() - row.startedAt.getTime() > row.maxRunWallClockMs;
}

export type RunCostCapDeps = {
  getStampedCostCap(runId: string): Promise<number | null>;
  sumRunCostCents(runId: string): Promise<number>;
};

// Reactive path: is this run over its stamped cost cap right now?
export async function evaluateRunCostCap(deps: RunCostCapDeps, runId: string): Promise<RunCapViolation | null> {
  const cap = await deps.getStampedCostCap(runId);
  if (cap == null) return null;
  const spent = await deps.sumRunCostCents(runId);
  return spent > cap ? { runId, reason: "cap-cost" } : null;
}

export type RunCapSweepDeps = {
  findRunningRunsWithCaps(): Promise<RunningRunCapRow[]>;
  sumRunCostCents(runId: string): Promise<number>;
  windDownRun(
    runId: string,
    opts: { mode: "hard"; resume: "when-allowed"; reason: RunCapReason },
  ): Promise<unknown>;
};

// Periodic sweep + crash-safe backstop for BOTH caps. Wall-clock is checked
// first (cheap, no query); cost only when wall-clock is fine and a cap is set.
export function makeRunCapSweepSource(deps: RunCapSweepDeps): ReconcileSource {
  return {
    name: "run-cap-sweep",
    async reconcile(now: Date): Promise<ReconcileResult> {
      const rows = await deps.findRunningRunsWithCaps();
      let drifted = 0;
      let repaired = 0;
      for (const row of rows) {
        let reason: RunCapReason | null = null;
        if (isWallClockExceeded(row, now)) {
          reason = "cap-wallclock";
        } else if (row.maxRunCostCents != null && (await deps.sumRunCostCents(row.id)) > row.maxRunCostCents) {
          reason = "cap-cost";
        }
        if (!reason) continue;
        drifted += 1;
        await deps.windDownRun(row.id, { mode: "hard", resume: "when-allowed", reason });
        repaired += 1;
      }
      return { source: "run-cap-sweep", drifted, repaired };
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run src/services/run-caps.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/run-caps.ts server/src/services/run-caps.test.ts
git commit -m "feat(run-caps): add per-run cap resolution, cost check, and sweep source"
```

---

### Task 4: Stamp caps at claim + expose cap query deps on the heartbeat service

**Files:**
- Modify: `server/src/services/heartbeat.ts` (`claimQueuedRun` ~`:7426`; service return object)
- Modify: `server/src/services/costs.ts` (add `sumRunCostCents`)
- Test: `server/src/__tests__/run-caps-stamp.integration.test.ts` (create)

**Interfaces:**
- Consumes: `resolveRunCaps`, `RunningRunCapRow`, `RunCaps` from `./run-caps.js`.
- Produces on the heartbeat service object:
  - `findRunningRunsWithCaps(): Promise<RunningRunCapRow[]>`
  - `getStampedCostCap(runId: string): Promise<number | null>`
  - and, on the cost service, `sumRunCostCents(runId: string): Promise<number>`

- [ ] **Step 1: Add `sumRunCostCents` to the cost service**

In `server/src/services/costs.ts`, add to the object returned by `costService(...)` (next to the other query methods):

```ts
    sumRunCostCents: async (runId: string): Promise<number> => {
      const [row] = await db
        .select({ total: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision` })
        .from(costEvents)
        .where(eq(costEvents.heartbeatRunId, runId));
      return Number(row?.total ?? 0);
    },
```

(`sql`, `eq`, `costEvents` are already imported in costs.ts — verify with `grep -n "costEvents\b" server/src/services/costs.ts | head -1`.)

- [ ] **Step 2: Import run-caps into heartbeat + add a claim-time resolver**

In `server/src/services/heartbeat.ts`, near the `run-wind-down.js` import:

```ts
import {
  resolveRunCaps,
  type RunCaps,
  type RunningRunCapRow,
} from "./run-caps.js";
```

Inside `heartbeatService(db)`, add a helper (place near `getCompanyMaxConcurrentRuns`, ~`:7298`):

```ts
  // Resolve the effective per-run ceilings for a company at claim time. Fail
  // open: any lookup error yields unlimited (null) rather than blocking claims.
  async function resolveStampedRunCaps(companyId: string): Promise<RunCaps> {
    let instance: RunCaps = { maxRunWallClockMs: null, maxRunCostCents: null };
    let company: RunCaps = { maxRunWallClockMs: null, maxRunCostCents: null };
    try {
      const general = await instanceSettingsService(db).getGeneral();
      instance = {
        maxRunWallClockMs: general.maxRunWallClockMs ?? null,
        maxRunCostCents: general.maxRunCostCents ?? null,
      };
    } catch (err) {
      logger.warn({ err }, "instance run-cap lookup failed; treating as unlimited");
    }
    try {
      const [row] = await db
        .select({ wc: companies.maxRunWallClockMs, cost: companies.maxRunCostCents })
        .from(companies)
        .where(eq(companies.id, companyId));
      company = { maxRunWallClockMs: row?.wc ?? null, maxRunCostCents: row?.cost ?? null };
    } catch (err) {
      logger.warn({ err }, "company run-cap lookup failed; treating as unlimited");
    }
    return resolveRunCaps({ company, instance });
  }
```

- [ ] **Step 3: Stamp the caps in the claim UPDATE**

In `claimQueuedRun`, replace the queued→running UPDATE (`heartbeat.ts:7426`):

```ts
    const claimedAt = new Date();
    const claimed = await db
      .update(heartbeatRuns)
      .set({
        status: "running",
        startedAt: run.startedAt ?? claimedAt,
        updatedAt: claimedAt,
      })
      .where(and(eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.status, "queued")))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!claimed) return null;
```

with:

```ts
    const claimedAt = new Date();
    const stampedCaps = await resolveStampedRunCaps(run.companyId);
    const claimed = await db
      .update(heartbeatRuns)
      .set({
        status: "running",
        startedAt: run.startedAt ?? claimedAt,
        updatedAt: claimedAt,
        maxRunWallClockMs: stampedCaps.maxRunWallClockMs,
        maxRunCostCents: stampedCaps.maxRunCostCents,
      })
      .where(and(eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.status, "queued")))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!claimed) return null;
```

- [ ] **Step 4: Add the cap-query methods + expose them**

Add inside `heartbeatService` (near `resolveStampedRunCaps`):

```ts
  async function findRunningRunsWithCaps(): Promise<RunningRunCapRow[]> {
    return db
      .select({
        id: heartbeatRuns.id,
        startedAt: heartbeatRuns.startedAt,
        maxRunWallClockMs: heartbeatRuns.maxRunWallClockMs,
        maxRunCostCents: heartbeatRuns.maxRunCostCents,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.status, "running"),
          or(isNotNull(heartbeatRuns.maxRunWallClockMs), isNotNull(heartbeatRuns.maxRunCostCents)),
        ),
      );
  }

  async function getStampedCostCap(runId: string): Promise<number | null> {
    const [row] = await db
      .select({ cap: heartbeatRuns.maxRunCostCents })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId));
    return row?.cap ?? null;
  }
```

Then in the service return object, near `windDownRun,`:

```ts
    findRunningRunsWithCaps,
    getStampedCostCap,
```

(`or` and `isNotNull` are from `drizzle-orm` — confirm they are in the top import at `heartbeat.ts:20`; `or` is already listed, add `isNotNull` if missing.)

- [ ] **Step 5: Write the stamp integration test**

Create `server/src/__tests__/run-caps-stamp.integration.test.ts`. The embedded-Postgres bootstrap (adapter mock, `describeEmbeddedPostgres`, `beforeAll`/`afterEach`/`afterAll`, `createCompany`, `createAgent`, `seedRunningRun`) is copied from `server/src/__tests__/run-wind-down.integration.test.ts`. Only the company-cap seed + claim + assertion below are new:

```ts
// inside describeEmbeddedPostgres(...), after the shared helpers:

it("stamps the resolved company cap onto the run at claim", async () => {
  const companyId = await createCompany();
  await db.update(companies).set({ maxRunCostCents: 250, maxRunWallClockMs: 600000 }).where(eq(companies.id, companyId));
  const agentId = await createAgent(companyId);

  // Seed a QUEUED run and claim it.
  const runId = randomUUID();
  await db.insert(heartbeatRuns).values({
    id: runId,
    companyId,
    agentId,
    invocationSource: "assignment",
    triggerDetail: "system",
    status: "queued",
  });
  await heartbeat.startNextQueuedRunForAgent(agentId);

  const [row] = await db
    .select({ status: heartbeatRuns.status, wc: heartbeatRuns.maxRunWallClockMs, cost: heartbeatRuns.maxRunCostCents })
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.id, runId));
  expect(row.status).toBe("running");
  expect(row.wc).toBe(600000);
  expect(row.cost).toBe(250);
});
```

Import `companies` from `@paperclipai/db` in this file. If `createAgent`/`createCompany`/`seedRunningRun` differ, copy their exact definitions from `run-wind-down.integration.test.ts`.

- [ ] **Step 6: Run test + typecheck**

Run: `cd server && npx vitest run src/__tests__/run-caps-stamp.integration.test.ts` → PASS (on a Postgres-capable host; else skipped).
Run: `cd server && pnpm typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/services/costs.ts server/src/__tests__/run-caps-stamp.integration.test.ts
git commit -m "feat(heartbeat): stamp per-run caps at claim and expose cap queries"
```

---

### Task 5: Reactive cost enforcement on the cost-record path

**Files:**
- Modify: `server/src/services/costs.ts` (`costService` signature + `createEvent`)
- Modify: `server/src/services/heartbeat.ts` (wire the hook at the `costService(db, budgetHooks)` construction, `:8270`)
- Test: `server/src/__tests__/run-caps-cost.integration.test.ts` (create)

**Interfaces:**
- Consumes: `evaluateRunCostCap` from `./run-caps.js`; `heartbeat.windDownRun`, `heartbeat.getStampedCostCap` (Task 4); `costService.sumRunCostCents` (Task 4).
- Produces: `costService(db, budgetHooks, costHooks?)` where `costHooks = { enforceRunCostCap?(heartbeatRunId: string): Promise<void> }`, invoked in `createEvent` after `budgets.evaluateCostEvent`.

- [ ] **Step 1: Add the cost hook to `costService`**

In `server/src/services/costs.ts`, extend the factory signature:

```ts
export type CostServiceHooks = {
  // Combo-01 Phase 2a: reactive per-run cost-cap enforcement, invoked after each
  // recorded cost event that carries a heartbeatRunId.
  enforceRunCostCap?: (heartbeatRunId: string) => Promise<void>;
};

export function costService(db: Db, budgetHooks: BudgetServiceHooks = {}, costHooks: CostServiceHooks = {}) {
```

At the end of `createEvent`, after `await budgets.evaluateCostEvent(event);` and before `return event;`:

```ts
      if (event.heartbeatRunId) {
        await costHooks.enforceRunCostCap?.(event.heartbeatRunId);
      }
```

- [ ] **Step 2: Wire the hook where costService is constructed in heartbeat**

In `server/src/services/heartbeat.ts:8270`, change:

```ts
      const costs = costService(db, budgetHooks);
```

to:

```ts
      const costs = costService(db, budgetHooks, {
        enforceRunCostCap: async (runId: string) => {
          const violation = await evaluateRunCostCap(
            { getStampedCostCap, sumRunCostCents: (id) => costService(db).sumRunCostCents(id) },
            runId,
          );
          if (violation) {
            await windDownRun(runId, { mode: "hard", resume: "when-allowed", reason: "cap-cost" });
          }
        },
      });
```

Add the import in heartbeat.ts (extend the existing `./run-caps.js` import from Task 4):

```ts
import { evaluateRunCostCap, resolveRunCaps, type RunCaps, type RunningRunCapRow } from "./run-caps.js";
```

(Note: `costService(db).sumRunCostCents` constructs a throwaway cost service purely for the query — acceptable, it holds no state. Alternatively hoist a single `sumRunCostCents` closure over `db`; keep it simple here.)

- [ ] **Step 2b: Update the other `costService` construction site**

`server/src/routes/costs.ts:71` constructs `costService(db, { cancelWorkForScope: heartbeat.cancelBudgetScopeWork })`. Add the same third arg so route-recorded cost events are also enforced:

```ts
  const costs = costService(
    db,
    { cancelWorkForScope: heartbeat.cancelBudgetScopeWork },
    {
      enforceRunCostCap: async (runId: string) => {
        const violation = await evaluateRunCostCap(
          { getStampedCostCap: heartbeat.getStampedCostCap, sumRunCostCents: (id) => costService(db).sumRunCostCents(id) },
          runId,
        );
        if (violation) {
          await heartbeat.windDownRun(runId, { mode: "hard", resume: "when-allowed", reason: "cap-cost" });
        }
      },
    },
  );
```

Add `import { evaluateRunCostCap } from "../services/run-caps.js";` to `routes/costs.ts`. (The periodic `run-cap-sweep` from Task 6 is the crash-safe backstop for any cost path not wired here.)

- [ ] **Step 3: Write the reactive-cost integration test**

Create `server/src/__tests__/run-caps-cost.integration.test.ts` (same bootstrap as the stamp test). Seed a running run with a stamped cost cap, record a cost event over the cap through the wired cost service, assert the run winds down:

```ts
it("winds down a run reactively when a cost event pushes it over the stamped cap", async () => {
  const companyId = await createCompany();
  const agentId = await createAgent(companyId);
  const runId = randomUUID();
  await db.insert(heartbeatRuns).values({
    id: runId,
    companyId,
    agentId,
    invocationSource: "assignment",
    triggerDetail: "system",
    status: "running",
    startedAt: new Date(),
    maxRunCostCents: 100,
  });

  // Record a cost event over the cap through the enforcement-wired cost service.
  const costs = costService(db, {}, {
    enforceRunCostCap: async (id: string) => {
      const violation = await evaluateRunCostCap(
        { getStampedCostCap: heartbeat.getStampedCostCap, sumRunCostCents: (x) => costService(db).sumRunCostCents(x) },
        id,
      );
      if (violation) await heartbeat.windDownRun(id, { mode: "hard", resume: "when-allowed", reason: "cap-cost" });
    },
  });
  await costs.createEvent(companyId, {
    agentId,
    heartbeatRunId: runId,
    costCents: 150,
    provider: "test",
    model: "test-model",
  });

  const [row] = await db
    .select({ status: heartbeatRuns.status, reason: heartbeatRuns.windDownReason })
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.id, runId));
  expect(row.status).toBe("wound_down");
  expect(row.reason).toBe("cap-cost");
});
```

Import `costService` from `../services/costs.ts` and `evaluateRunCostCap` from `../services/run-caps.ts` in this test file. If `createEvent`'s required fields differ, copy a working `createEvent` call from `server/src/__tests__/costs-service.test.ts`.

- [ ] **Step 4: Run test + typecheck**

Run: `cd server && npx vitest run src/__tests__/run-caps-cost.integration.test.ts` → PASS.
Run: `cd server && pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/costs.ts server/src/services/heartbeat.ts server/src/routes/costs.ts server/src/__tests__/run-caps-cost.integration.test.ts
git commit -m "feat(costs): reactively wind down runs that exceed their per-run cost cap"
```

---

### Task 6: Register the `run-cap-sweep` reconcile source + wall-clock integration proof

**Files:**
- Modify: `server/src/index.ts:69` (import) and `:896` (reconcile array)
- Test: `server/src/__tests__/run-caps-sweep.integration.test.ts` (create)

**Interfaces:**
- Consumes: `makeRunCapSweepSource` (Task 3); `heartbeat.findRunningRunsWithCaps` (Task 4); `costService(db).sumRunCostCents` (Task 4); `heartbeat.windDownRun`.
- Produces: the periodic reconcile loop also runs `run-cap-sweep`.

- [ ] **Step 1: Import + register the source**

In `server/src/index.ts`, add near the existing run-wind-down import (`:70`):

```ts
import { makeRunCapSweepSource } from "./services/run-caps.js";
import { costService } from "./services/costs.js";
```

(If `costService` is already imported via `./services/index.js`, reuse that import instead of adding a duplicate — check `grep -n "costService" server/src/index.ts`.)

At `index.ts:896`, extend the `runReconcile([...])` array:

```ts
      void runReconcile(
        [
          ...phase1ReconcileSources({ reapOrphanedRuns: heartbeat.reapOrphanedRuns }),
          makeWoundDownResumeSource({
            findResumableOrphans: heartbeat.findResumableWoundDownOrphans,
            reenqueueOrphan: heartbeat.reenqueueWoundDownOrphan,
          }),
          makeRunCapSweepSource({
            findRunningRunsWithCaps: heartbeat.findRunningRunsWithCaps,
            sumRunCostCents: (runId) => costService(db).sumRunCostCents(runId),
            windDownRun: heartbeat.windDownRun,
          }),
        ],
        new Date(),
      )
```

(Use the same `db` handle the surrounding scope already holds for `heartbeat`.)

- [ ] **Step 2: Write the wall-clock sweep integration test**

Create `server/src/__tests__/run-caps-sweep.integration.test.ts` (same bootstrap). Seed a running run whose `startedAt` is older than its stamped wall-clock cap, run one `runReconcile` pass with the sweep source, assert it winds down:

```ts
import { makeRunCapSweepSource } from "../services/run-caps.ts";
import { runReconcile } from "../services/admission-reconciler.ts";
import { costService } from "../services/costs.ts";

it("wall-clock sweep winds down a run older than its stamped cap", async () => {
  const companyId = await createCompany();
  const agentId = await createAgent(companyId);
  const runId = randomUUID();
  await db.insert(heartbeatRuns).values({
    id: runId,
    companyId,
    agentId,
    invocationSource: "assignment",
    triggerDetail: "system",
    status: "running",
    startedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
    maxRunWallClockMs: 60000, // 1 min cap
  });

  const results = await runReconcile(
    [
      makeRunCapSweepSource({
        findRunningRunsWithCaps: heartbeat.findRunningRunsWithCaps,
        sumRunCostCents: (id) => costService(db).sumRunCostCents(id),
        windDownRun: heartbeat.windDownRun,
      }),
    ],
    new Date(),
  );
  expect(results).toContainEqual({ source: "run-cap-sweep", drifted: 1, repaired: 1 });

  const [row] = await db
    .select({ status: heartbeatRuns.status, reason: heartbeatRuns.windDownReason })
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.id, runId));
  expect(row.status).toBe("wound_down");
  expect(row.reason).toBe("cap-wallclock");
});
```

- [ ] **Step 3: Run test + typecheck**

Run: `cd server && npx vitest run src/__tests__/run-caps-sweep.integration.test.ts` → PASS.
Run: `cd server && pnpm typecheck` → PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts server/src/__tests__/run-caps-sweep.integration.test.ts
git commit -m "feat(heartbeat): register run-cap-sweep reconcile source (wall-clock + cost backstop)"
```

---

### Task 7: Operator config UI — CompanySettings + InstanceGeneralSettings

**Files:**
- Modify: `ui/src/api/companies.ts:59`
- Modify: `ui/src/pages/CompanySettings.tsx` (`:69`, `:97`, `:197`)
- Modify: `ui/src/pages/InstanceGeneralSettings.tsx` (`:73`, `:93`, `:120`)

**Interfaces:**
- Consumes: the API fields from Task 2.
- Produces: operator inputs for both caps on the company + instance settings screens.

- [ ] **Step 1: Extend the company API update type**

In `ui/src/api/companies.ts`, in the update payload type near `maxConcurrentRuns?: number | null`:

```ts
  maxRunWallClockMs?: number | null;
  maxRunCostCents?: number | null;
```

- [ ] **Step 2: Wire CompanySettings inputs**

In `ui/src/pages/CompanySettings.tsx`, mirroring the existing `maxRuns` field:
- Add state next to `const [maxRuns, setMaxRuns] = ...`:

```tsx
  const [maxRunWallClockMs, setMaxRunWallClockMs] = useState("");
  const [maxRunCostCents, setMaxRunCostCents] = useState("");
```

- Seed them where `setMaxRuns(...)` runs (`:69`):

```tsx
    setMaxRunWallClockMs(String(selectedCompany.maxRunWallClockMs ?? ""));
    setMaxRunCostCents(String(selectedCompany.maxRunCostCents ?? ""));
```

- Include them in the dirty check (`:97`) alongside `maxRuns`.
- Add to the `handleSaveGeneral` payload (`:197-204`), mirroring `maxConcurrentRuns: maxRunsPayload`:

```tsx
      maxRunWallClockMs: maxRunWallClockMs.trim() === "" ? null : Number(maxRunWallClockMs),
      maxRunCostCents: maxRunCostCents.trim() === "" ? null : Number(maxRunCostCents),
```

- Add two labeled number `<input>`s next to the existing max-concurrent-runs input, following that field's exact markup (label + input + `onChange={(e) => setMaxRunWallClockMs(e.target.value)}`). Copy the surrounding element structure from the `maxRuns` input so styling matches.

- [ ] **Step 3: Wire InstanceGeneralSettings inputs**

In `ui/src/pages/InstanceGeneralSettings.tsx`, mirroring its `maxConcurrentRuns` handling:
- Add state + seed (near `:93`).
- Add to the `updateGeneralMutation` payload (`:120-121`), mirroring `maxConcurrentRuns: trimmedMaxRuns === "" ? null : Number(...)`:

```tsx
      maxRunWallClockMs: trimmedWallClock === "" ? null : Number(trimmedWallClock),
      maxRunCostCents: trimmedCost === "" ? null : Number(trimmedCost),
```

- Add two labeled number inputs following the existing max-concurrent-runs input's markup.

- [ ] **Step 4: Build the UI**

Run: `pnpm --filter @paperclipai/ui build` (or the repo's UI typecheck: `cd ui && pnpm typecheck` if present).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/api/companies.ts ui/src/pages/CompanySettings.tsx ui/src/pages/InstanceGeneralSettings.tsx
git commit -m "feat(ui): per-run wall-clock and cost cap inputs on company + instance settings"
```

---

## Done criteria

- `maxRunWallClockMs` + `maxRunCostCents` configurable on instance (general JSONB) and company (columns), settable via API + UI, round-tripped without `.strip()` loss.
- Effective caps (`company ?? instance`) stamped onto each `heartbeat_runs` row at claim.
- A run over its cost cap winds down reactively (`resume: "when-allowed"`, reason `cap-cost`); a run over its wall-clock cap winds down within one reconcile tick (reason `cap-wallclock`); the sweep re-checks cost as a crash-safe backstop.
- `run-caps.ts` is a pure, injected module fully covered by fake-deps unit tests; stamping, reactive cost, and wall-clock sweep each have an embedded-Postgres integration proof.
- No `maxToolCalls`/step-count enforcement (that is Phase 2b).
