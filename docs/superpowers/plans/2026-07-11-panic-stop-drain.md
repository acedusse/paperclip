# Panic Stop + Drain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manual fleet kill-switch — instance + company `runExecutionState` (`running`/`draining`/`halted`). Drain blocks new run starts; Panic also winds down in-flight runs (checkpointed, resumable); Resume relies on the existing concurrency cap to ramp back.

**Architecture:** Enforcement is two coordinated mechanisms: (1) a `panicDrainWriter` registered at the reserved top-precedence `panic-drain` slot forces the admission budget to 0 (and makes admission-status report it); (2) a guard in `claimQueuedRun` holds runs on the direct `executeRun` claim path that bypasses the budget gate. Panic winds down in-flight runs via the existing `windDownRun(mode:hard, resume:when-allowed, reason:"panic")`. A `panic-halt-sweep` reconcile source is the crash-safe backstop. State is persisted (company column + instance `general` JSONB) so it survives crashes.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Zod, Vitest, React (UI). Design spec: `docs/superpowers/specs/2026-07-11-panic-stop-drain-design.md`.

## Global Constraints

- Migrations are **hand-written** (`drizzle-kit generate` unusable — drift past `0098`). Next number is `0110`. Add `.sql` + a `_journal.json` entry.
- State field name is **`runExecutionState`** (values `"running" | "draining" | "halted"`) — `executionState` and `executionMode` are already taken. Company = real column `run_execution_state text NOT NULL DEFAULT 'running'`; instance = key in the `general` JSONB (added to `instanceGeneralSettingsSchema` AND carried through `normalizeGeneralSettings`, else `.strip()` drops it).
- **Reversible panic:** Panic winds down with `windDownRun(id, { mode:"hard", resume:"when-allowed", reason:"panic" })` (reason already in `WindDownReason`). (design decision 1)
- **No resume-ramp writer:** Resume just persists `running`; the existing per-tick concurrency-cap admission governs the ramp. (design decision 2)
- **Both scopes:** instance state cascades to companies via the admission gate's `min(instanceCap, companyCap)`. Company-scope resolver sites + the claim guard use the **most-severe(instance, company)** effective state; instance sites use instance state. Severity: `halted > draining > running`. (design decisions 3, effective-state rule)
- **Drain holds, does not cancel.** The `claimQueuedRun` guard returns `null` (leaves the row `queued`) — it must NOT call any cancel path. (design decision 5)
- `isScopeQuiescing` / effective-state lookups are **fail-open**: any DB lookup error is treated as `running`, so a transient blip never wedges the fleet.
- Follow the injected-deps + fake-deps-unit-test pattern of `run-caps.ts` / `run-wind-down.ts` / `admission-reconciler.ts`.
- Run tests: `cd server && npx vitest run <path>`; ui: `cd ui && npx vitest run <path>`. Build db: `pnpm --filter @paperclipai/db build`. Build shared: `pnpm --filter @paperclipai/shared build`. Typecheck: `cd server && pnpm typecheck`, `cd ui && pnpm typecheck`.

---

### Task 1: Schema — `run_execution_state` column on `companies`, migration 0110

**Files:**
- Modify: `packages/db/src/schema/companies.ts:35`
- Create: `packages/db/src/migrations/0110_run_execution_state.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`

**Interfaces:**
- Produces: `companies.runExecutionState` (text, not-null, default `'running'`) on the Drizzle table.

- [ ] **Step 1: Add the company column**

In `packages/db/src/schema/companies.ts`, immediately after the `maxRunTurns` line (`:35`):

```ts
    maxRunTurns: integer("max_run_turns"),
    // Combo-01 Phase 2c: fleet execution state. running = normal; draining =
    // refuse new run starts; halted = refuse new + in-flight wound down.
    runExecutionState: text("run_execution_state").notNull().default("running"),
```

(`text` is already imported in this file.)

- [ ] **Step 2: Write the migration**

Create `packages/db/src/migrations/0110_run_execution_state.sql`:

```sql
ALTER TABLE "companies" ADD COLUMN "run_execution_state" text DEFAULT 'running' NOT NULL;
```

- [ ] **Step 3: Register the migration in the journal**

In `packages/db/src/migrations/meta/_journal.json`, append after the `0109_per_run_turn_cap` entry:

```json
    {
      "idx": 110,
      "version": "7",
      "when": 1781902500000,
      "tag": "0110_run_execution_state",
      "breakpoints": true
    }
```

(Add a comma after the `0109` entry's closing brace.)

- [ ] **Step 4: Build the db package**

Run: `pnpm --filter @paperclipai/db build`
Expected: succeeds, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/companies.ts packages/db/src/migrations/0110_run_execution_state.sql packages/db/src/migrations/meta/_journal.json
git commit -m "feat(db): add run_execution_state column to companies"
```

---

### Task 2: Shared type + Zod enum + instance/company wiring

**Files:**
- Create: `packages/shared/src/validators/run-execution-state.ts`
- Modify: `packages/shared/src/validators/instance.ts:54`
- Modify: `packages/shared/src/types/instance.ts` (after `maxRunTurns`)
- Modify: `packages/shared/src/types/company.ts` (after `maxRunTurns`)
- Modify: `packages/shared/src/index.ts` (export the new module) — only if the package uses a barrel; see Step 1.

**Interfaces:**
- Produces: `RunExecutionState = "running" | "draining" | "halted"`; `runExecutionStateSchema` (Zod enum); `InstanceGeneralSettings.runExecutionState?`; `Company.runExecutionState?`.

- [ ] **Step 1: Create the shared enum + type**

Create `packages/shared/src/validators/run-execution-state.ts`:

```ts
import { z } from "zod";

// Combo-01 Phase 2c: fleet execution state for an instance or company.
// running = normal admission; draining = refuse NEW run starts, let in-flight
// finish; halted = refuse new + wind down in-flight (reversibly).
export const RUN_EXECUTION_STATES = ["running", "draining", "halted"] as const;
export const runExecutionStateSchema = z.enum(RUN_EXECUTION_STATES);
export type RunExecutionState = z.infer<typeof runExecutionStateSchema>;
```

Then ensure it is re-exported. Check how the package exposes validators: `grep -n "validators/instance" packages/shared/src/index.ts`. If there is a barrel export line for validators, add:

```ts
export * from "./validators/run-execution-state.js";
```

next to the existing validator exports. If `@paperclipai/shared` re-exports each validator file individually, mirror that pattern.

- [ ] **Step 2: Add to the instance general schema**

In `packages/shared/src/validators/instance.ts`, first add the import at the top (beside the other imports):

```ts
import { runExecutionStateSchema } from "./run-execution-state.js";
```

Then, in `instanceGeneralSettingsSchema`, immediately after the `maxRunTurns` line (`:54`):

```ts
  maxRunTurns: z.number().int().positive().nullable().optional(),
  runExecutionState: runExecutionStateSchema.optional(),
```

- [ ] **Step 3: Add to the instance type**

In `packages/shared/src/types/instance.ts`, immediately after the `maxRunTurns` line, add (import the type at the top if the file has an import block; otherwise inline the union):

```ts
  maxRunTurns?: number | null;
  runExecutionState?: "running" | "draining" | "halted";
```

- [ ] **Step 4: Add to the company type**

In `packages/shared/src/types/company.ts`, immediately after the `maxRunTurns` line:

```ts
  maxRunTurns?: number | null;
  runExecutionState?: "running" | "draining" | "halted";
```

- [ ] **Step 5: Build the shared package**

Run: `pnpm --filter @paperclipai/shared build`
Expected: succeeds, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): RunExecutionState enum + instance/company wiring"
```

---

### Task 3: Instance normalize carry-through

**Files:**
- Modify: `server/src/services/instance-settings.ts:52`
- Test: `server/src/__tests__/instance-settings-service.test.ts`

**Interfaces:**
- Consumes: `InstanceGeneralSettings.runExecutionState` (Task 2).
- Produces: `normalizeGeneralSettings` preserves an explicit `runExecutionState`.

> **Note:** `normalizeGeneralSettings` is not exported; carry-through is proven via the `instanceSettingsService` round-trip (`updateGeneral` → `getGeneral`) against embedded Postgres in `server/src/__tests__/instance-settings-service.test.ts` (same pattern the 2a/2b cap fields use). If embedded Postgres is unavailable the `describeEmbeddedPostgres` block SKIPS — then add the code + tests, note the skip, and use `cd server && pnpm typecheck` as GREEN evidence.

- [ ] **Step 1: Write the failing tests**

In `server/src/__tests__/instance-settings-service.test.ts`, inside the existing `describeEmbeddedPostgres("instanceSettingsService.getGeneral maxConcurrentRuns", ...)` block, after the `maxRunTurns` tests, add:

```ts
  it("persists and reads back runExecutionState", async () => {
    const svc = instanceSettingsService(db);
    await svc.updateGeneral({ runExecutionState: "halted" });
    expect((await svc.getGeneral()).runExecutionState).toBe("halted");
  });

  it("omits runExecutionState when unset (defaults to running at read sites)", async () => {
    const svc = instanceSettingsService(db);
    expect((await svc.getGeneral()).runExecutionState).toBeUndefined();
  });

  it("clears runExecutionState back to running", async () => {
    const svc = instanceSettingsService(db);
    await svc.updateGeneral({ runExecutionState: "draining" });
    expect((await svc.getGeneral()).runExecutionState).toBe("draining");

    await svc.updateGeneral({ runExecutionState: "running" });
    // "running" is the default; normalize only carries through a non-running state (see Step 3).
    expect((await svc.getGeneral()).runExecutionState).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail (RED)**

Run: `cd server && npx vitest run src/__tests__/instance-settings-service.test.ts`
Expected: FAIL — "persists and reads back runExecutionState" returns `undefined` (normalize drops it). (If SKIPPED, proceed; use Step 4 typecheck as GREEN.)

- [ ] **Step 3: Carry the field through normalize**

In `server/src/services/instance-settings.ts`, immediately after the `maxRunTurns` carry-through line (`:52`):

```ts
      ...(parsed.data.maxRunTurns ? { maxRunTurns: parsed.data.maxRunTurns } : {}),
      // Only carry a non-default state; "running" (or absent) reads as unset.
      ...(parsed.data.runExecutionState && parsed.data.runExecutionState !== "running"
        ? { runExecutionState: parsed.data.runExecutionState }
        : {}),
```

- [ ] **Step 4: Run tests to verify they pass (GREEN)**

Run: `cd server && npx vitest run src/__tests__/instance-settings-service.test.ts`
Expected: PASS. (If skipped: `cd server && pnpm typecheck` clean is GREEN evidence.)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/instance-settings.ts server/src/__tests__/instance-settings-service.test.ts
git commit -m "feat(config): carry runExecutionState through instance normalize"
```

---

### Task 4: `effective-cap-resolver` — `CapContext.executionState` + `panicDrainWriter`

**Files:**
- Modify: `server/src/services/effective-cap-resolver.ts:27,41`
- Modify: `server/src/services/effective-cap-resolver.test.ts`

**Interfaces:**
- Consumes: `RunExecutionState` (Task 2).
- Produces:
  - `CapContext = { configuredMax: number | null; executionState?: RunExecutionState }`.
  - `panicDrainWriter: CapWriter` (returns `0` when `executionState` is `"halted"`/`"draining"`, else `null`).
  - `PHASE1_WRITERS = [panicDrainWriter, configuredDefaultWriter]`.

- [ ] **Step 1: Write the failing tests**

In `server/src/services/effective-cap-resolver.test.ts`, add to the imports (`:17-19`) `panicDrainWriter`:

```ts
  CAP_WRITER_PRECEDENCE,
  PHASE1_WRITERS,
  configuredDefaultWriter,
  panicDrainWriter,
```

Add a new `describe` block (the existing precedence + `source:"none"` tests stay unchanged and still pass because `executionState` is absent there):

```ts
describe("panicDrainWriter", () => {
  it("forces cap 0 when halted", () => {
    expect(panicDrainWriter.resolve({ configuredMax: 10, executionState: "halted" })).toBe(0);
  });
  it("forces cap 0 when draining", () => {
    expect(panicDrainWriter.resolve({ configuredMax: 10, executionState: "draining" })).toBe(0);
  });
  it("has no opinion when running", () => {
    expect(panicDrainWriter.resolve({ configuredMax: 10, executionState: "running" })).toBeNull();
  });
  it("has no opinion when state is absent", () => {
    expect(panicDrainWriter.resolve({ configuredMax: 10 })).toBeNull();
  });
  it("is registered at top precedence (index 0)", () => {
    expect(panicDrainWriter.precedence).toBe(CAP_WRITER_PRECEDENCE.indexOf("panic-drain"));
    expect(panicDrainWriter.precedence).toBe(0);
  });
  it("wins over configured-default when halted (resolveEffectiveCap)", () => {
    const { cap, source } = resolveEffectiveCap(
      { configuredMax: 10, executionState: "halted" },
      PHASE1_WRITERS,
    );
    expect(cap).toBe(0);
    expect(source).toBe("panic-drain");
  });
  it("falls through to configured-default when running", () => {
    const { cap, source } = resolveEffectiveCap(
      { configuredMax: 10, executionState: "running" },
      PHASE1_WRITERS,
    );
    expect(cap).toBe(10);
    expect(source).toBe("configured-default");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (RED)**

Run: `cd server && npx vitest run src/services/effective-cap-resolver.test.ts`
Expected: FAIL — `panicDrainWriter` is not exported.

- [ ] **Step 3: Implement the CapContext field + writer**

In `server/src/services/effective-cap-resolver.ts`, add the import at the top:

```ts
import type { RunExecutionState } from "@paperclipai/shared";
```

Replace the `CapContext` type (`:27`):

```ts
export type CapContext = { configuredMax: number | null; executionState?: RunExecutionState };
```

After `configuredDefaultWriter` (before `PHASE1_WRITERS` at `:41`), add:

```ts
// Combo-01 Phase 2c: top-precedence writer. draining/halted force the cap to 0
// so the admission budget admits nothing. Absent/running = no opinion.
export const panicDrainWriter: CapWriter = {
  name: "panic-drain",
  precedence: CAP_WRITER_PRECEDENCE.indexOf("panic-drain"),
  resolve: (ctx) =>
    ctx.executionState === "halted" || ctx.executionState === "draining" ? 0 : null,
};
```

Replace the `PHASE1_WRITERS` line (`:41`):

```ts
export const PHASE1_WRITERS: CapWriter[] = [panicDrainWriter, configuredDefaultWriter];
```

- [ ] **Step 4: Run tests to verify they pass (GREEN)**

Run: `cd server && npx vitest run src/services/effective-cap-resolver.test.ts`
Expected: PASS (new panic-drain cases + existing precedence/source-none/default cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/effective-cap-resolver.ts server/src/services/effective-cap-resolver.test.ts
git commit -m "feat(cap-resolver): panicDrainWriter forces cap 0 when draining/halted"
```

---

### Task 5: `run-execution-state.ts` — effective-state helper + `panic-halt-sweep` source

**Files:**
- Create: `server/src/services/run-execution-state.ts`
- Create: `server/src/services/run-execution-state.test.ts`

**Interfaces:**
- Consumes: `RunExecutionState` (Task 2); `ReconcileSource`/`ReconcileResult` (`admission-reconciler.ts`).
- Produces:
  - `resolveEffectiveExecutionState(instance, company): RunExecutionState` — most-severe.
  - `isQuiescing(state): boolean` — `state !== "running"`.
  - `type HaltedScope = { kind: "instance" } | { kind: "company"; companyId: string }` and `RunningRunRow = { id: string }`.
  - `makePanicHaltSweepSource(deps): ReconcileSource` (name `"panic-halt-sweep"`).

- [ ] **Step 1: Write the failing tests**

Create `server/src/services/run-execution-state.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  resolveEffectiveExecutionState,
  isQuiescing,
  makePanicHaltSweepSource,
} from "./run-execution-state.js";

describe("resolveEffectiveExecutionState", () => {
  it("takes the most-severe of instance and company", () => {
    expect(resolveEffectiveExecutionState("running", "running")).toBe("running");
    expect(resolveEffectiveExecutionState("running", "draining")).toBe("draining");
    expect(resolveEffectiveExecutionState("draining", "running")).toBe("draining");
    expect(resolveEffectiveExecutionState("halted", "running")).toBe("halted");
    expect(resolveEffectiveExecutionState("running", "halted")).toBe("halted");
    expect(resolveEffectiveExecutionState("draining", "halted")).toBe("halted");
  });
});

describe("isQuiescing", () => {
  it("is true for draining and halted, false for running", () => {
    expect(isQuiescing("running")).toBe(false);
    expect(isQuiescing("draining")).toBe(true);
    expect(isQuiescing("halted")).toBe(true);
  });
});

describe("makePanicHaltSweepSource", () => {
  it("winds down running runs in halted scopes with reason panic", async () => {
    const windDownRun = vi.fn(async () => ({ outcome: "terminated" as const }));
    const source = makePanicHaltSweepSource({
      findRunningRunsInHaltedScopes: vi.fn(async () => [{ id: "r1" }, { id: "r2" }]),
      windDownRun,
    });
    const result = await source.reconcile(new Date());
    expect(source.name).toBe("panic-halt-sweep");
    expect(windDownRun).toHaveBeenCalledTimes(2);
    expect(windDownRun).toHaveBeenCalledWith("r1", {
      mode: "hard",
      resume: "when-allowed",
      reason: "panic",
    });
    expect(result).toEqual({ source: "panic-halt-sweep", drifted: 2, repaired: 2 });
  });

  it("is a no-op when no halted scope has running runs", async () => {
    const windDownRun = vi.fn(async () => ({ outcome: "noop" as const }));
    const source = makePanicHaltSweepSource({
      findRunningRunsInHaltedScopes: vi.fn(async () => []),
      windDownRun,
    });
    const result = await source.reconcile(new Date());
    expect(windDownRun).not.toHaveBeenCalled();
    expect(result).toEqual({ source: "panic-halt-sweep", drifted: 0, repaired: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (RED)**

Run: `cd server && npx vitest run src/services/run-execution-state.test.ts`
Expected: FAIL — module `./run-execution-state.js` not found / exports missing.

- [ ] **Step 3: Implement the module**

Create `server/src/services/run-execution-state.ts`:

```ts
// Combo-01 Phase 2c: fleet execution-state helpers + crash-safe panic backstop.
// Pure + dependency-injected, like run-caps.ts.
import type { RunExecutionState } from "@paperclipai/shared";
import type { ReconcileResult, ReconcileSource } from "./admission-reconciler.js";

const SEVERITY: Record<RunExecutionState, number> = { running: 0, draining: 1, halted: 2 };

// Most-severe of the two scopes wins (halted > draining > running).
export function resolveEffectiveExecutionState(
  instance: RunExecutionState,
  company: RunExecutionState,
): RunExecutionState {
  return SEVERITY[instance] >= SEVERITY[company] ? instance : company;
}

export function isQuiescing(state: RunExecutionState): boolean {
  return state !== "running";
}

export type RunningRunRow = { id: string };

export type PanicHaltSweepDeps = {
  // Ground-truth query: running runs whose effective scope state is "halted".
  findRunningRunsInHaltedScopes(): Promise<RunningRunRow[]>;
  windDownRun(
    runId: string,
    opts: { mode: "hard"; resume: "when-allowed"; reason: "panic" },
  ): Promise<unknown>;
};

// Crash-safe backstop: any run still running under a halted scope is wound down.
// Only "halted" is swept — "draining" intentionally lets in-flight runs finish.
export function makePanicHaltSweepSource(deps: PanicHaltSweepDeps): ReconcileSource {
  return {
    name: "panic-halt-sweep",
    async reconcile(_now: Date): Promise<ReconcileResult> {
      const rows = await deps.findRunningRunsInHaltedScopes();
      let repaired = 0;
      for (const row of rows) {
        await deps.windDownRun(row.id, { mode: "hard", resume: "when-allowed", reason: "panic" });
        repaired += 1;
      }
      return { source: "panic-halt-sweep", drifted: rows.length, repaired };
    },
  };
}
```

`ReconcileResult` is `{ source: string; drifted: number; repaired: number }` (`admission-reconciler.ts:21`) — the `toEqual` in the test matches it exactly.

- [ ] **Step 4: Run tests to verify they pass (GREEN)**

Run: `cd server && npx vitest run src/services/run-execution-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/run-execution-state.ts server/src/services/run-execution-state.test.ts
git commit -m "feat(run-execution-state): effective-state helper + panic-halt-sweep source"
```

---

### Task 6: Heartbeat enforcement wiring — thread state, claim guard, admission status

**Files:**
- Modify: `server/src/services/heartbeat.ts` (resolver sites `:7367,7383,8437,8448`; `claimQueuedRun` `:7398`; `AdmissionStatus` `:3404`; new lookup helpers)
- Modify: `server/src/__tests__/instance-admission-status-routes.test.ts`, `server/src/__tests__/heartbeat-instance-admission.test.ts` (add `runExecutionState` to exact-match assertions — see Step 3)
- Test: `server/src/__tests__/panic-drain.integration.test.ts` (new)

**Interfaces:**
- Consumes: `panicDrainWriter`/`PHASE1_WRITERS` with `executionState` (Task 4); `resolveEffectiveExecutionState`/`isQuiescing` (Task 5).
- Produces: `getCompanyRunExecutionState(companyId)`, `getInstanceRunExecutionState()`, `getEffectiveExecutionState(companyId)`, `isScopeQuiescing(companyId)` (heartbeat-internal); the 4 resolver sites pass `executionState`; `claimQueuedRun` holds when quiescing; `AdmissionStatus.runExecutionState`.

- [ ] **Step 1: Add state-lookup helpers**

In `server/src/services/heartbeat.ts`, near `getCompanyMaxConcurrentRuns` (`:7305`), add:

```ts
  async function getInstanceRunExecutionState(): Promise<RunExecutionState> {
    try {
      return (await instanceSettingsService(db).getGeneral()).runExecutionState ?? "running";
    } catch (err) {
      logger.warn({ err }, "instance run-execution-state lookup failed; treating as running");
      return "running";
    }
  }

  async function getCompanyRunExecutionState(companyId: string): Promise<RunExecutionState> {
    try {
      const [row] = await db
        .select({ s: companies.runExecutionState })
        .from(companies)
        .where(eq(companies.id, companyId));
      return (row?.s as RunExecutionState | undefined) ?? "running";
    } catch (err) {
      logger.warn({ err }, "company run-execution-state lookup failed; treating as running");
      return "running";
    }
  }

  async function getEffectiveExecutionState(companyId: string): Promise<RunExecutionState> {
    const [instance, company] = await Promise.all([
      getInstanceRunExecutionState(),
      getCompanyRunExecutionState(companyId),
    ]);
    return resolveEffectiveExecutionState(instance, company);
  }

  async function isScopeQuiescing(companyId: string): Promise<boolean> {
    return isQuiescing(await getEffectiveExecutionState(companyId));
  }
```

Add the imports at the top of the file (beside the `run-caps.js` import):

```ts
import { resolveEffectiveExecutionState, isQuiescing } from "./run-execution-state.js";
import type { RunExecutionState } from "@paperclipai/shared";
```

- [ ] **Step 2: Thread `executionState` into the 4 resolver sites**

`getInstanceAdmissionStatus` (`:7367`): resolve instance state and pass it, and include it in the returned status.

```ts
  async function getInstanceAdmissionStatus(): Promise<AdmissionStatus> {
    const general = await instanceSettingsService(db).getGeneral();
    const runExecutionState = general.runExecutionState ?? "running";
    const { cap, source } = resolveEffectiveCap(
      { configuredMax: general.maxConcurrentRuns ?? null, executionState: runExecutionState },
      PHASE1_WRITERS,
    );
    return {
      cap,
      source,
      running: await countRunningRunsInstanceWide(),
      queued: await countQueuedRunsInstanceWide(),
      runExecutionState,
    };
  }
```

`getCompanyAdmissionStatus` (`:7383`): use the effective (most-severe) state.

```ts
  async function getCompanyAdmissionStatus(companyId: string): Promise<AdmissionStatus> {
    const runExecutionState = await getEffectiveExecutionState(companyId);
    const { cap, source } = resolveEffectiveCap(
      { configuredMax: await getCompanyMaxConcurrentRuns(companyId), executionState: runExecutionState },
      PHASE1_WRITERS,
    );
    return {
      cap,
      source,
      running: await countRunningRunsForCompany(companyId),
      queued: await countQueuedRunsForCompany(companyId),
      runExecutionState,
    };
  }
```

Admission gate instance site (`:8437`): the `general` is already fetched there — pass its state:

```ts
        const general = await instanceSettingsService(db).getGeneral();
        ({ cap: instanceCap } = resolveEffectiveCap(
          { configuredMax: general.maxConcurrentRuns ?? null, executionState: general.runExecutionState ?? "running" },
          PHASE1_WRITERS,
        ));
```

Admission gate company site (`:8448`): use the effective state:

```ts
        const companyMax = await getCompanyMaxConcurrentRuns(agent.companyId);
        ({ cap: companyCap } = resolveEffectiveCap(
          { configuredMax: companyMax, executionState: await getEffectiveExecutionState(agent.companyId) },
          PHASE1_WRITERS,
        ));
```

- [ ] **Step 3: Extend the `AdmissionStatus` type**

In `server/src/services/heartbeat.ts` (`:3404`):

```ts
export type AdmissionStatus = {
  cap: number | null;
  source: string;
  running: number;
  queued: number;
  runExecutionState: RunExecutionState;
};
```

**This adds a key to every returned admission status, so existing exact-match `.toEqual({ cap, source, running, queued })` assertions must gain `runExecutionState: "running"`.** Update these four:
- `server/src/__tests__/instance-admission-status-routes.test.ts:142,157,186` — add `runExecutionState: "running"` to each expected object.
- `server/src/__tests__/heartbeat-instance-admission.test.ts:374` — same.

(If any of these tests set the state to draining/halted before asserting, use that state value instead of `"running"`. Run both suites in Step 6 to confirm.)

- [ ] **Step 4: Add the claim guard**

In `claimQueuedRun` (`:7398`), immediately after `if (run.status !== "queued") return run;`:

```ts
    if (run.status !== "queued") return run;
    // Combo-01 Phase 2c: while the scope is draining/halted, HOLD the run —
    // return null (leaves the row queued, does NOT cancel), so Resume re-admits
    // it. Covers the executeRun direct-claim path that skips the budget gate.
    if (await isScopeQuiescing(run.companyId)) return null;
```

- [ ] **Step 5: Write the integration test**

Create `server/src/__tests__/panic-drain.integration.test.ts` mirroring the setup of `server/src/__tests__/run-caps-stamp.integration.test.ts` (copy its imports, adapter mock, `describeEmbeddedPostgres`/`beforeAll`/`afterEach`/`afterAll`, and `createCompany`/`createAgent` helpers verbatim). Then add:

```ts
  it("draining a company holds new claims and leaves running runs untouched", async () => {
    const companyId = await createCompany();
    await db.update(companies).set({ runExecutionState: "draining" }).where(eq(companies.id, companyId));
    const agentId = await createAgent(companyId);

    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId,
      invocationSource: "assignment", triggerDetail: "system", status: "queued",
    });
    await heartbeat.startNextQueuedRunForAgent(agentId);

    const [row] = await db.select({ status: heartbeatRuns.status })
      .from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(row.status).toBe("queued"); // held, not started
  });

  it("resume lets a previously-held run start", async () => {
    const companyId = await createCompany();
    await db.update(companies).set({ runExecutionState: "halted" }).where(eq(companies.id, companyId));
    const agentId = await createAgent(companyId);
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId,
      invocationSource: "assignment", triggerDetail: "system", status: "queued",
    });
    await heartbeat.startNextQueuedRunForAgent(agentId);
    expect((await db.select({ s: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0].s).toBe("queued");

    await db.update(companies).set({ runExecutionState: "running" }).where(eq(companies.id, companyId));
    await heartbeat.startNextQueuedRunForAgent(agentId);
    expect((await db.select({ s: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0].s).toBe("running");
  });

  it("instance halt cascades to block a company that is itself running", async () => {
    const companyId = await createCompany();
    await instanceSettingsService(db).updateGeneral({ runExecutionState: "halted" });
    const agentId = await createAgent(companyId);
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId,
      invocationSource: "assignment", triggerDetail: "system", status: "queued",
    });
    await heartbeat.startNextQueuedRunForAgent(agentId);
    expect((await db.select({ s: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0].s).toBe("queued");
  });
```

Import `instanceSettingsService` from `../services/instance-settings.ts` and `companies` from `@paperclipai/db` in the test (add to the copied import block).

- [ ] **Step 6: Run the integration test + typecheck**

Run: `cd server && npx vitest run src/__tests__/panic-drain.integration.test.ts src/__tests__/instance-admission-status-routes.test.ts src/__tests__/heartbeat-instance-admission.test.ts`
Expected: PASS (panic-drain integration may SKIP without embedded Postgres; the two admission suites must pass with the updated assertions).
Run: `cd server && pnpm typecheck`
Expected: clean — every `resolveEffectiveCap` ctx and `AdmissionStatus` construction now carries the new fields.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/panic-drain.integration.test.ts server/src/__tests__/instance-admission-status-routes.test.ts server/src/__tests__/heartbeat-instance-admission.test.ts
git commit -m "feat(heartbeat): drain/halt gating — cap-writer state + claimQueuedRun hold guard"
```

---

### Task 7: Panic fan-out + state-setters + register the sweep source

**Files:**
- Modify: `server/src/services/heartbeat.ts` (running-run enumeration; `setInstanceRunExecutionState`/`setCompanyRunExecutionState`; `panicStopScope`; `findRunningRunsInHaltedScopes`; expose in the returned service object)
- Modify: `server/src/index.ts` (register `panic-halt-sweep`)
- Test: `server/src/__tests__/panic-drain.integration.test.ts` (extend)

**Interfaces:**
- Consumes: `windDownRun` (heartbeat, pre-bound `:12177`); `makePanicHaltSweepSource` (Task 5); the state helpers (Task 6).
- Produces: `heartbeat.setInstanceRunExecutionState(state)`, `heartbeat.setCompanyRunExecutionState(companyId, state)`, `heartbeat.findRunningRunsInHaltedScopes()` (for the sweep deps).

- [ ] **Step 1: Add running-run enumeration + halted-scope query**

In `server/src/services/heartbeat.ts`, near `countRunningRunsForCompany` (`:7281`), add row-returning variants:

```ts
  async function findRunningRunsForCompany(companyId: string): Promise<{ id: string }[]> {
    return db.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.status, "running")));
  }

  async function findRunningRunsInstanceWide(): Promise<{ id: string }[]> {
    return db.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
      .where(eq(heartbeatRuns.status, "running"));
  }

  // Running runs whose EFFECTIVE scope state is halted (instance halt covers all
  // companies; otherwise only companies individually halted). Used by the sweep.
  async function findRunningRunsInHaltedScopes(): Promise<{ id: string }[]> {
    if ((await getInstanceRunExecutionState()) === "halted") {
      return findRunningRunsInstanceWide();
    }
    const haltedCompanies = await db.select({ id: companies.id }).from(companies)
      .where(eq(companies.runExecutionState, "halted"));
    if (haltedCompanies.length === 0) return [];
    return db.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
      .where(and(
        eq(heartbeatRuns.status, "running"),
        inArray(heartbeatRuns.companyId, haltedCompanies.map((c) => c.id)),
      ));
  }
```

(Ensure `inArray` is imported from `drizzle-orm` in this file; if not, add it.)

- [ ] **Step 2: Add the panic fan-out + state-setters**

Add near the `windDownRun` wiring (`:12177`):

```ts
  async function panicStopRuns(runs: { id: string }[]): Promise<void> {
    for (const run of runs) {
      await windDownRun(run.id, { mode: "hard", resume: "when-allowed", reason: "panic" });
    }
  }

  // actor mirrors the shape threaded into companies.ts audit calls:
  // { actorType, actorId, agentId?, runId? }.
  type ExecutionStateActor = {
    actorType: string; actorId: string; agentId?: string | null; runId?: string | null;
  };

  async function setCompanyRunExecutionState(
    companyId: string, state: RunExecutionState, actor: ExecutionStateActor,
  ): Promise<void> {
    const from = await getCompanyRunExecutionState(companyId);
    await db.update(companies).set({ runExecutionState: state, updatedAt: new Date() })
      .where(eq(companies.id, companyId));
    let runsWoundDown = 0;
    if (state === "halted") {
      const runs = await findRunningRunsForCompany(companyId);
      await panicStopRuns(runs);
      runsWoundDown = runs.length;
    }
    await logActivity(db, {
      companyId, actorType: actor.actorType, actorId: actor.actorId,
      agentId: actor.agentId ?? null, runId: actor.runId ?? null,
      action: "company.run_execution_state_changed", entityType: "company", entityId: companyId,
      details: { from, to: state, runsWoundDown },
    });
  }

  async function setInstanceRunExecutionState(
    state: RunExecutionState, actor: ExecutionStateActor,
  ): Promise<void> {
    const from = await getInstanceRunExecutionState();
    await instanceSettingsService(db).updateGeneral({ runExecutionState: state });
    let runsWoundDown = 0;
    if (state === "halted") {
      const runs = await findRunningRunsInstanceWide();
      await panicStopRuns(runs);
      runsWoundDown = runs.length;
    }
    // Instance-scope audit: companyId is required by logActivity, so log per
    // affected company is overkill — use a single instance marker row.
    await logActivity(db, {
      companyId: null, actorType: actor.actorType, actorId: actor.actorId,
      agentId: actor.agentId ?? null, runId: actor.runId ?? null,
      action: "instance.run_execution_state_changed", entityType: "instance", entityId: "instance",
      details: { from, to: state, runsWoundDown },
    });
  }
```

Verify against the codebase: (a) `companies` has an `updatedAt` column — if not, drop that field from the `.set`; (b) `logActivity`'s `companyId` accepts `null` for an instance-scope row — if it is required non-null, log the instance transition without a `companyId` via whatever instance-audit helper exists, or omit the instance audit and note it. `logActivity` is imported already in `heartbeat.ts` (used in `claimQueuedRun`).

- [ ] **Step 3: Expose the new methods on the service object**

In the returned object of `heartbeatService` (near where `windDownRun`, `findRunningRunsWithCaps` are exposed, `:12606`/`:12611`), add:

```ts
    setCompanyRunExecutionState,
    setInstanceRunExecutionState,
    findRunningRunsInHaltedScopes,
```

- [ ] **Step 4: Register the sweep source in `index.ts`**

In `server/src/index.ts`, add the import (beside `makeRunCapSweepSource`, `:71`):

```ts
import { makePanicHaltSweepSource } from "./services/run-execution-state.js";
```

In the `runReconcile([...])` array (`:898`), after the `makeRunCapSweepSource(...)` entry, add:

```ts
      makePanicHaltSweepSource({
        findRunningRunsInHaltedScopes: heartbeat.findRunningRunsInHaltedScopes,
        windDownRun: heartbeat.windDownRun,
      }),
```

- [ ] **Step 5: Extend the integration test (panic + sweep)**

In `server/src/__tests__/panic-drain.integration.test.ts`, add:

```ts
  it("halting a company winds down its running runs (resumable)", async () => {
    const companyId = await createCompany();
    const agentId = await createAgent(companyId);
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId,
      invocationSource: "assignment", triggerDetail: "system", status: "running", startedAt: new Date(),
    });

    await heartbeat.setCompanyRunExecutionState(companyId, "halted");

    const [row] = await db.select({ status: heartbeatRuns.status, reason: heartbeatRuns.windDownReason, resume: heartbeatRuns.resumePolicy })
      .from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(row.status).toBe("wound_down");
    expect(row.reason).toBe("panic");
    expect(row.resume).toBe("when-allowed");
    expect((await db.select({ s: companies.runExecutionState }).from(companies).where(eq(companies.id, companyId)))[0].s).toBe("halted");
  });

  it("panic-halt-sweep winds down a run that slipped into running under a halted company", async () => {
    const companyId = await createCompany();
    await db.update(companies).set({ runExecutionState: "halted" }).where(eq(companies.id, companyId));
    const agentId = await createAgent(companyId);
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId,
      invocationSource: "assignment", triggerDetail: "system", status: "running", startedAt: new Date(),
    });

    const rows = await heartbeat.findRunningRunsInHaltedScopes();
    expect(rows.map((r) => r.id)).toContain(runId);
    const source = makePanicHaltSweepSource({
      findRunningRunsInHaltedScopes: heartbeat.findRunningRunsInHaltedScopes,
      windDownRun: heartbeat.windDownRun,
    });
    const result = await source.reconcile(new Date());
    expect(result.repaired).toBeGreaterThanOrEqual(1);
    expect((await db.select({ s: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0].s).toBe("wound_down");
  });
```

Add `makePanicHaltSweepSource` to the test's imports from `../services/run-execution-state.ts`.

- [ ] **Step 6: Run tests + typecheck**

Run: `cd server && npx vitest run src/__tests__/panic-drain.integration.test.ts`
Expected: PASS (or SKIPPED without embedded Postgres).
Run: `cd server && pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/index.ts server/src/__tests__/panic-drain.integration.test.ts
git commit -m "feat(heartbeat): panic fan-out + execution-state setters + panic-halt-sweep source"
```

---

### Task 8: Routes — execution-state setters (company + instance)

**Files:**
- Modify: `server/src/routes/companies.ts` (after the `/:companyId/admission-status` route `:154`)
- Modify: `server/src/routes/instance-settings.ts` (after the `/instance/admission-status` route `:51`)

**Interfaces:**
- Consumes: `heartbeat.setCompanyRunExecutionState`, `heartbeat.setInstanceRunExecutionState` (Task 7); `runExecutionStateSchema` (Task 2).
- Produces: `POST /companies/:companyId/execution-state`, `POST /instance/execution-state`.

- [ ] **Step 1: Add the company route**

In `server/src/routes/companies.ts`, add an import for the schema (beside the other validator imports, `:35`):

```ts
import { z } from "zod";
import { runExecutionStateSchema } from "@paperclipai/shared";
```

(If `z` is already imported, don't duplicate.) After the `/:companyId/admission-status` route (`:158`), add:

```ts
  const executionStateBodySchema = z.object({ state: runExecutionStateSchema });
  router.post(
    "/:companyId/execution-state",
    validate(executionStateBodySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);
      const actor = getActorInfo(req); // { actorType, actorId, agentId?, runId? } — already imported (:47)
      await heartbeat.setCompanyRunExecutionState(companyId, req.body.state, actor);
      res.json(await heartbeat.getCompanyAdmissionStatus(companyId));
    },
  );
```

Confirm `heartbeat` is in scope in this router factory (it is used by the admission-status route just above). If the route file receives `heartbeat` via a different name, match it.

- [ ] **Step 2: Add the instance route**

In `server/src/routes/instance-settings.ts`, after the `/instance/admission-status` route (`:54`), add (import `z` and `runExecutionStateSchema` if not present; use the file's existing instance-admin assertion — `assertCanManageInstanceSettings` — as seen on the POST routes at `:171`):

```ts
  router.post(
    "/instance/execution-state",
    validate(z.object({ state: runExecutionStateSchema })),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      await heartbeat.setInstanceRunExecutionState(req.body.state, getActorInfo(req));
      res.json(await heartbeat.getInstanceAdmissionStatus());
    },
  );
```

- [ ] **Step 3: Typecheck**

Run: `cd server && pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/companies.ts server/src/routes/instance-settings.ts
git commit -m "feat(routes): execution-state setter endpoints (company + instance)"
```

---

### Task 9: UI — execution-state control + status badge

**Files:**
- Modify: `ui/src/components/AdmissionStatusLine.tsx`
- Modify: `ui/src/api/companies.ts`, `ui/src/api/instanceSettings.ts` (add `runExecutionState` to `AdmissionStatus`; add setter calls)
- Modify: `ui/src/pages/CompanySettings.tsx`, `ui/src/pages/InstanceGeneralSettings.tsx`

**Interfaces:**
- Consumes: the execution-state routes (Task 8); the extended `AdmissionStatus`.
- Produces: a Drain / Panic / Resume control + state badge on both settings pages.

- [ ] **Step 1: Extend the `AdmissionStatus` types + add setter API calls**

In `ui/src/api/instanceSettings.ts`, add `runExecutionState: "running" | "draining" | "halted"` to the `AdmissionStatus` type, and a setter:

```ts
export async function setInstanceExecutionState(state: "running" | "draining" | "halted") {
  return apiFetch("/instance/execution-state", { method: "POST", body: JSON.stringify({ state }) });
}
```

(Match the file's existing `apiFetch`/return conventions.) In `ui/src/api/companies.ts`, add the same field to its `AdmissionStatus` (if defined there) and:

```ts
export async function setCompanyExecutionState(companyId: string, state: "running" | "draining" | "halted") {
  return apiFetch(`/companies/${companyId}/execution-state`, { method: "POST", body: JSON.stringify({ state }) });
}
```

- [ ] **Step 2: Show the state in `AdmissionStatusLine`**

In `ui/src/components/AdmissionStatusLine.tsx`, render the state when it is not `running`:

```tsx
  const cap = status.cap === null ? "unlimited" : String(status.cap);
  const stateBadge =
    status.runExecutionState && status.runExecutionState !== "running" ? (
      <span className="ml-1 font-medium text-destructive">· {status.runExecutionState}</span>
    ) : null;
  return (
    <span className="text-xs text-muted-foreground">
      running {status.running} / cap {cap} · {status.queued} queued{stateBadge}
    </span>
  );
```

Update `AdmissionStatusLine.test.tsx` if it asserts on the rendered text for a status object — add `runExecutionState: "running"` to its fixtures so they type-check, and add one case asserting the `draining`/`halted` badge renders.

- [ ] **Step 3: Add the control to both settings pages**

In `ui/src/pages/CompanySettings.tsx` and `ui/src/pages/InstanceGeneralSettings.tsx`, beside the existing `AdmissionStatusLine`, add three buttons wired to the setter mutations (invalidate the admission-status query on success). Panic must confirm first:

```tsx
  const executionState = admissionStatusQuery.data?.runExecutionState ?? "running";
  // ... inside the JSX, next to <AdmissionStatusLine .../>:
  <div className="flex items-center gap-2">
    <Button size="sm" variant="outline" disabled={executionState === "draining"}
      onClick={() => executionStateMutation.mutate("draining")}>Drain</Button>
    <Button size="sm" variant="destructive" disabled={executionState === "halted"}
      onClick={() => { if (window.confirm("Panic will cancel all in-flight runs (checkpointed, resumable). Continue?")) executionStateMutation.mutate("halted"); }}>Panic</Button>
    <Button size="sm" variant="outline" disabled={executionState === "running"}
      onClick={() => executionStateMutation.mutate("running")}>Resume</Button>
  </div>
```

Define `executionStateMutation` with `useMutation` calling `setCompanyExecutionState(selectedCompanyId!, state)` (company page) / `setInstanceExecutionState(state)` (instance page), invalidating the admission-status query key on success — mirror the existing `generalMutation`/`updateGeneralMutation` patterns in each file. Import `Button` if not already imported.

- [ ] **Step 4: Typecheck + run existing settings tests**

Run: `cd ui && pnpm typecheck`
Expected: clean.
Run: `cd ui && npx vitest run src/components/AdmissionStatusLine.test.tsx src/pages/InstanceGeneralSettings.test.tsx src/pages/CompanySettings.test.tsx`
Expected: PASS (update fixtures per Step 2 if a `runExecutionState`-less `AdmissionStatus` fixture fails to type-check).

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/AdmissionStatusLine.tsx ui/src/api/companies.ts ui/src/api/instanceSettings.ts ui/src/pages/CompanySettings.tsx ui/src/pages/InstanceGeneralSettings.tsx ui/src/components/AdmissionStatusLine.test.tsx
git commit -m "feat(ui): drain/panic/resume control + execution-state badge"
```

---

## Final verification

- [ ] **Full typecheck:** `cd server && pnpm typecheck` and `cd ui && pnpm typecheck` — both clean.
- [ ] **db build:** `pnpm --filter @paperclipai/db build` — clean.
- [ ] **Panic/drain suites:** `cd server && npx vitest run src/services/effective-cap-resolver.test.ts src/services/run-execution-state.test.ts src/__tests__/panic-drain.integration.test.ts src/__tests__/instance-settings-service.test.ts` — all PASS (integration may skip without embedded Postgres).
- [ ] **UI suites:** `cd ui && npx vitest run src/components/AdmissionStatusLine.test.tsx src/pages/InstanceGeneralSettings.test.tsx src/pages/CompanySettings.test.tsx` — all PASS.
- [ ] **Manual sanity (optional):** Drain a company → new runs stay queued, running ones finish. Panic → running runs go `wound_down`/`panic`. Resume → queued runs start again (bounded by the concurrency cap). Halt the instance → all companies blocked.
