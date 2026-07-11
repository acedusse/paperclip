# Per-Run Turn Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce a per-run `maxRunTurns` ceiling — configured on instance + company, stamped onto each run at claim, injected as the effective `--max-turns` for adapters that support a turn flag (`claude_local`, `grok_local`), tightest-wins against the agent's own limit.

**Architecture:** Promotes the existing per-agent `maxTurnsPerRun` adapter-config value into the Phase-2a stamped per-run cap plane. The cap resolves `company ?? instance ?? null` (reusing 2a's `resolveRunCaps`), is frozen onto the `heartbeat_runs` row at claim, and is applied at the `runtimeConfig` assembly in `executeRun` via a pure `applyRunTurnCap` helper that computes `min(agentConfigValue, stampedCap)` and writes it to the adapter-appropriate config field. Enforcement is delegated to the CLI subprocess (in-process `--max-turns`), so there is **no reconcile sweep and no `windDownRun` path** — a run that hits the limit rides the existing max-turns→continuation machinery. Unsupported adapters silently no-op.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Zod, Vitest, React (UI). Design spec: `docs/superpowers/specs/2026-07-11-per-run-turn-cap-design.md`.

## Global Constraints

- Migrations are **hand-written** (`drizzle-kit generate` is unusable in this repo — schema drift past `0098`). Next number is `0109`. Add `.sql` + a `_journal.json` entry. (spec: Schema changes)
- **Instance** cap value lives inside the `instance_settings.general` JSONB (added to `instanceGeneralSettingsSchema` AND carried through `normalizeGeneralSettings`, else `.strip()` drops it). **Company** cap value is a real integer column. (spec: Config storage)
- Resolution is `company ?? instance ?? null`; null = unlimited. Reuse 2a's `resolveRunCaps` — do **not** fork it. (spec: Design decision 2)
- Effective value passed to the CLI is **`min(agentConfigValue ?? Infinity, stampedCap ?? Infinity)`** — tightest-wins. When both are unset the config is left byte-for-byte unchanged (backwards compatible). (spec: Design decision 3)
- Enforcement is **delegated to the adapter CLI**. Do **not** add a `ReconcileSource`, `windDownRun` call, or `RunCapReason` for turns. (spec: Design decision 1)
- Adapter field map: `claude_local` → config field `maxTurnsPerRun`; `grok_local` → config field `maxTurns`. Any other `adapterType` → no write (silent no-op). (spec: Injection at execute)
- All new Zod fields use `z.number().int().positive().nullable().optional()`. (spec: Config storage)
- Run tests: `cd server && npx vitest run <path>`. Build db package: `pnpm --filter @paperclipai/db build`. Typecheck server: `cd server && pnpm typecheck`. Typecheck ui: `cd ui && pnpm typecheck`.

---

### Task 1: Schema — `max_run_turns` on `companies` + `heartbeat_runs`, migration 0109

**Files:**
- Modify: `packages/db/src/schema/companies.ts:33`
- Modify: `packages/db/src/schema/heartbeat_runs.ts:79`
- Create: `packages/db/src/migrations/0109_per_run_turn_cap.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `companies.maxRunTurns`, `heartbeatRuns.maxRunTurns` (nullable integers) on the Drizzle tables.

- [ ] **Step 1: Add the company column**

In `packages/db/src/schema/companies.ts`, immediately after the `maxRunCostCents` line (`:33`):

```ts
    maxRunCostCents: integer("max_run_cost_cents"),
    // Combo-01 Phase 2b per-run turn ceiling (company override; null = unset).
    maxRunTurns: integer("max_run_turns"),
```

- [ ] **Step 2: Add the stamped run column**

In `packages/db/src/schema/heartbeat_runs.ts`, immediately after the `maxRunCostCents` line (`:79`):

```ts
    maxRunCostCents: integer("max_run_cost_cents"),
    // Combo-01 Phase 2b: effective per-run turn ceiling, stamped at claim from
    // company ?? instance config. Null = unlimited. Audit/observability only;
    // enforcement is delegated to the adapter CLI (--max-turns).
    maxRunTurns: integer("max_run_turns"),
```

- [ ] **Step 3: Write the migration**

Create `packages/db/src/migrations/0109_per_run_turn_cap.sql`:

```sql
ALTER TABLE "companies" ADD COLUMN "max_run_turns" integer;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "max_run_turns" integer;
```

- [ ] **Step 4: Register the migration in the journal**

In `packages/db/src/migrations/meta/_journal.json`, append to the `entries` array (after the `0108_per_run_caps` entry). The final entries must read:

```json
    {
      "idx": 108,
      "version": "7",
      "when": 1781902300000,
      "tag": "0108_per_run_caps",
      "breakpoints": true
    },
    {
      "idx": 109,
      "version": "7",
      "when": 1781902400000,
      "tag": "0109_per_run_turn_cap",
      "breakpoints": true
    }
```

- [ ] **Step 5: Build the db package to verify the schema compiles**

Run: `pnpm --filter @paperclipai/db build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/companies.ts packages/db/src/schema/heartbeat_runs.ts packages/db/src/migrations/0109_per_run_turn_cap.sql packages/db/src/migrations/meta/_journal.json
git commit -m "feat(db): add per-run turn cap columns"
```

---

### Task 2: Shared validators + types — instance + company `maxRunTurns`

**Files:**
- Modify: `packages/shared/src/validators/instance.ts:53`
- Modify: `packages/shared/src/types/instance.ts:65`
- Modify: `packages/shared/src/validators/company.ts:54`
- Modify: `packages/shared/src/types/company.ts:31`

**Interfaces:**
- Consumes: nothing.
- Produces: `InstanceGeneralSettings.maxRunTurns?: number | null`; `UpdateCompany.maxRunTurns` accepted by `updateCompanySchema`; `Company.maxRunTurns?: number | null`.

- [ ] **Step 1: Add the field to the instance general schema**

In `packages/shared/src/validators/instance.ts`, immediately after the `maxRunCostCents` line (`:53`):

```ts
  maxRunCostCents: z.number().int().positive().nullable().optional(),
  maxRunTurns: z.number().int().positive().nullable().optional(),
```

- [ ] **Step 2: Add the field to the instance type**

In `packages/shared/src/types/instance.ts`, immediately after the `maxRunCostCents` line (`:65`):

```ts
  maxRunCostCents?: number | null;
  maxRunTurns?: number | null;
```

- [ ] **Step 3: Add the field to the company update schema**

In `packages/shared/src/validators/company.ts`, immediately after the `maxRunCostCents` line (`:54`):

```ts
    maxRunCostCents: z.number().int().positive().nullable().optional(),
    maxRunTurns: z.number().int().positive().nullable().optional(),
```

- [ ] **Step 4: Add the field to the company type**

In `packages/shared/src/types/company.ts`, immediately after the `maxRunCostCents` line (`:31`):

```ts
  maxRunCostCents?: number | null;
  maxRunTurns?: number | null;
```

- [ ] **Step 5: Build the shared package**

Run: `pnpm --filter @paperclipai/shared build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/validators/instance.ts packages/shared/src/types/instance.ts packages/shared/src/validators/company.ts packages/shared/src/types/company.ts
git commit -m "feat(shared): accept per-run turn cap on instance + company"
```

---

### Task 3: Instance-settings normalize carry-through

**Files:**
- Modify: `server/src/services/instance-settings.ts:51`
- Test: `server/src/__tests__/instance-settings-service.test.ts`

**Interfaces:**
- Consumes: `InstanceGeneralSettings.maxRunTurns` (Task 2).
- Produces: `normalizeGeneralSettings` preserves an explicit `maxRunTurns` through the `.strip()` storage schema.

**Note (corrected during execution):** `normalizeGeneralSettings` is **not exported**, so it cannot be unit-tested directly. The established 2a pattern proves carry-through via a round-trip through `instanceSettingsService` (`updateGeneral` → `getGeneral`) against embedded Postgres, in `server/src/__tests__/instance-settings-service.test.ts`. Follow that. If embedded Postgres is unavailable the `describeEmbeddedPostgres` block SKIPS; in that case still add the tests + carry-through line, note the skip, and use `cd server && pnpm typecheck` as GREEN evidence.

- [ ] **Step 1: Write the failing tests**

In `server/src/__tests__/instance-settings-service.test.ts`, inside the existing `describeEmbeddedPostgres("instanceSettingsService.getGeneral maxConcurrentRuns", ...)` block, after the "clears per-run caps when set to null" test, add (mirroring the sibling `maxRunWallClockMs`/`maxRunCostCents` round-trip tests exactly):

```ts
  it("persists and reads back maxRunTurns", async () => {
    const svc = instanceSettingsService(db);
    await svc.updateGeneral({ maxRunTurns: 42 });
    expect((await svc.getGeneral()).maxRunTurns).toBe(42);
  });

  it("omits maxRunTurns when unset (unlimited)", async () => {
    const svc = instanceSettingsService(db);
    expect((await svc.getGeneral()).maxRunTurns).toBeUndefined();
  });

  it("clears maxRunTurns when set to null", async () => {
    const svc = instanceSettingsService(db);
    await svc.updateGeneral({ maxRunTurns: 42 });
    expect((await svc.getGeneral()).maxRunTurns).toBe(42);

    await svc.updateGeneral({ maxRunTurns: null });
    expect((await svc.getGeneral()).maxRunTurns).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests to verify they fail (RED)**

Run: `cd server && npx vitest run src/__tests__/instance-settings-service.test.ts`
Expected: FAIL — "persists and reads back maxRunTurns" fails because normalize drops `maxRunTurns` (comes back `undefined`). (If the suite SKIPS for lack of embedded Postgres, proceed and rely on the Step 4 typecheck as GREEN evidence.)

- [ ] **Step 3: Carry the field through normalize**

In `server/src/services/instance-settings.ts`, immediately after the `maxRunCostCents` carry-through line (`:51`):

```ts
      ...(parsed.data.maxRunCostCents ? { maxRunCostCents: parsed.data.maxRunCostCents } : {}),
      ...(parsed.data.maxRunTurns ? { maxRunTurns: parsed.data.maxRunTurns } : {}),
```

- [ ] **Step 4: Run the tests to verify they pass (GREEN)**

Run: `cd server && npx vitest run src/__tests__/instance-settings-service.test.ts`
Expected: PASS. (If skipped: `cd server && pnpm typecheck` clean substitutes as GREEN evidence.)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/instance-settings.ts server/src/__tests__/instance-settings-service.test.ts
git commit -m "feat(config): carry per-run turn cap through instance normalize"
```

---

### Task 4: `run-caps.ts` — extend `RunCaps`/`resolveRunCaps` + add `applyRunTurnCap`

**Files:**
- Modify: `server/src/services/run-caps.ts:5,18-23`
- Modify: `server/src/services/run-caps.test.ts:10-28`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RunCaps = { maxRunWallClockMs: number | null; maxRunCostCents: number | null; maxRunTurns: number | null }`.
  - `resolveRunCaps` now also reduces `maxRunTurns`.
  - `const RUN_TURN_CONFIG_FIELD_BY_ADAPTER: Record<string, string>` — the adapter→config-field map.
  - `applyRunTurnCap<T extends Record<string, unknown>>(config: T, stampedTurns: number | null, adapterType: string): T` — returns a new config (same type) with the effective `min` written to the adapter's turn field, or the input reference unchanged when the adapter is unsupported or there is nothing to cap.

- [ ] **Step 1: Extend the `RunCaps` type**

In `server/src/services/run-caps.ts`, replace the `RunCaps` type (`:5`):

```ts
export type RunCaps = { maxRunWallClockMs: number | null; maxRunCostCents: number | null; maxRunTurns: number | null };
```

- [ ] **Step 2: Extend `resolveRunCaps`**

In `server/src/services/run-caps.ts`, replace the body of `resolveRunCaps` (`:18-23`):

```ts
// company overrides instance, per field. null = unlimited.
export function resolveRunCaps(input: { company: RunCaps; instance: RunCaps }): RunCaps {
  return {
    maxRunWallClockMs: input.company.maxRunWallClockMs ?? input.instance.maxRunWallClockMs,
    maxRunCostCents: input.company.maxRunCostCents ?? input.instance.maxRunCostCents,
    maxRunTurns: input.company.maxRunTurns ?? input.instance.maxRunTurns,
  };
}
```

- [ ] **Step 3: Write the failing unit tests for the turn logic**

In `server/src/services/run-caps.test.ts`, update the two existing `resolveRunCaps` cases (`:10-28`) to include the new field, and add a new `describe` block for `applyRunTurnCap`. First update the import (`:2-8`) to add `applyRunTurnCap`:

```ts
import {
  applyRunTurnCap,
  evaluateRunCostCap,
  isWallClockExceeded,
  makeRunCapSweepSource,
  resolveRunCaps,
  type RunningRunCapRow,
} from "./run-caps.js";
```

Replace the two existing `resolveRunCaps` assertions so the expected objects carry `maxRunTurns`:

```ts
describe("resolveRunCaps", () => {
  it("company overrides instance per field", () => {
    expect(
      resolveRunCaps({
        company: { maxRunWallClockMs: 1000, maxRunCostCents: null, maxRunTurns: 20 },
        instance: { maxRunWallClockMs: 9999, maxRunCostCents: 500, maxRunTurns: 99 },
      }),
    ).toEqual({ maxRunWallClockMs: 1000, maxRunCostCents: 500, maxRunTurns: 20 });
  });

  it("both null => unlimited", () => {
    expect(
      resolveRunCaps({
        company: { maxRunWallClockMs: null, maxRunCostCents: null, maxRunTurns: null },
        instance: { maxRunWallClockMs: null, maxRunCostCents: null, maxRunTurns: null },
      }),
    ).toEqual({ maxRunWallClockMs: null, maxRunCostCents: null, maxRunTurns: null });
  });
});
```

Then append this new block:

```ts
describe("applyRunTurnCap", () => {
  it("stamped cap tightens claude_local's maxTurnsPerRun", () => {
    const out = applyRunTurnCap({ maxTurnsPerRun: 1000 }, 50, "claude_local");
    expect(out).toEqual({ maxTurnsPerRun: 50 });
  });

  it("agent's own limit wins when it is tighter", () => {
    const out = applyRunTurnCap({ maxTurnsPerRun: 30 }, 50, "claude_local");
    expect(out).toEqual({ maxTurnsPerRun: 30 });
  });

  it("uses grok_local's maxTurns field", () => {
    const out = applyRunTurnCap({ maxTurns: 1000 }, 40, "grok_local");
    expect(out).toEqual({ maxTurns: 40 });
  });

  it("writes the stamped cap when the agent field is unset", () => {
    const out = applyRunTurnCap({}, 25, "claude_local");
    expect(out).toEqual({ maxTurnsPerRun: 25 });
  });

  it("leaves config untouched when both are unset", () => {
    const input = { maxTurnsPerRun: undefined };
    const out = applyRunTurnCap(input, null, "claude_local");
    expect(out).toBe(input);
  });

  it("no-ops (returns input) for an unsupported adapter", () => {
    const input = { maxTurnsPerRun: 1000 };
    const out = applyRunTurnCap(input, 10, "codex_local");
    expect(out).toBe(input);
  });

  it("does not mutate the input config", () => {
    const input = { maxTurnsPerRun: 1000 };
    applyRunTurnCap(input, 50, "claude_local");
    expect(input).toEqual({ maxTurnsPerRun: 1000 });
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd server && npx vitest run src/services/run-caps.test.ts`
Expected: FAIL — `applyRunTurnCap` is not exported (import error / not a function).

- [ ] **Step 5: Implement `applyRunTurnCap` + the adapter field map**

In `server/src/services/run-caps.ts`, append after `resolveRunCaps` (before the `isWallClockExceeded` export):

```ts
// The per-adapter config field that carries the CLI turn limit. Adapters absent
// from this map do not accept a turn flag today; the cap silently no-ops for them.
export const RUN_TURN_CONFIG_FIELD_BY_ADAPTER: Record<string, string> = {
  claude_local: "maxTurnsPerRun",
  grok_local: "maxTurns",
};

// Tightest-wins: a governance cap can only LOWER the agent's own turn limit.
// Returns a new config with the effective min written to the adapter's turn
// field, or the input unchanged when the adapter is unsupported or there is
// nothing to cap. Reads a non-positive/non-finite current value as "unset".
export function applyRunTurnCap<T extends Record<string, unknown>>(
  config: T,
  stampedTurns: number | null,
  adapterType: string,
): T {
  const field = RUN_TURN_CONFIG_FIELD_BY_ADAPTER[adapterType];
  if (!field) return config;
  const raw = (config as Record<string, unknown>)[field];
  const current = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : Infinity;
  const stamped = stampedTurns != null && stampedTurns > 0 ? stampedTurns : Infinity;
  const effective = Math.min(current, stamped);
  if (!Number.isFinite(effective)) return config;
  return { ...config, [field]: effective } as T;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && npx vitest run src/services/run-caps.test.ts`
Expected: PASS (all `resolveRunCaps` and `applyRunTurnCap` cases).

- [ ] **Step 7: Commit**

```bash
git add server/src/services/run-caps.ts server/src/services/run-caps.test.ts
git commit -m "feat(run-caps): resolve per-run turn cap + applyRunTurnCap helper"
```

---

### Task 5: Resolve + stamp `maxRunTurns` at claim

**Files:**
- Modify: `server/src/services/heartbeat.ts:7315-7316,7320-7321,7328,7331,7492`
- Test: `server/src/__tests__/run-caps-stamp.integration.test.ts:148-175`

**Interfaces:**
- Consumes: `resolveRunCaps` (Task 4), `companies.maxRunTurns` (Task 1), `InstanceGeneralSettings.maxRunTurns` (Task 2).
- Produces: `resolveStampedRunCaps` returns a `RunCaps` carrying `maxRunTurns`; the claim UPDATE stamps `heartbeat_runs.max_run_turns`.

- [ ] **Step 1: Write the failing integration test**

In `server/src/__tests__/run-caps-stamp.integration.test.ts`, add a second `it` after the existing stamp test (`:175`), mirroring its structure:

```ts
  it("stamps the resolved company turn cap onto the run at claim", async () => {
    const companyId = await createCompany();
    await db
      .update(companies)
      .set({ maxRunTurns: 42 })
      .where(eq(companies.id, companyId));
    const agentId = await createAgent(companyId);

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
      .select({ status: heartbeatRuns.status, turns: heartbeatRuns.maxRunTurns })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId));
    expect(row.status).toBe("running");
    expect(row.turns).toBe(42);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/run-caps-stamp.integration.test.ts`
Expected: FAIL — `row.turns` is `null` (the claim UPDATE does not stamp `maxRunTurns` yet). If embedded Postgres is unavailable the suite is skipped; in that case proceed and rely on Step 4's typecheck, and note the skip in the commit.

- [ ] **Step 3: Resolve `maxRunTurns` and stamp it at claim**

In `server/src/services/heartbeat.ts`, in `resolveStampedRunCaps`, update the two `RunCaps` literals (`:7315-7316`) to include the new field:

```ts
    let instance: RunCaps = { maxRunWallClockMs: null, maxRunCostCents: null, maxRunTurns: null };
    let company: RunCaps = { maxRunWallClockMs: null, maxRunCostCents: null, maxRunTurns: null };
```

Update the instance read (`:7319-7322`) to carry the field:

```ts
      instance = {
        maxRunWallClockMs: general.maxRunWallClockMs ?? null,
        maxRunCostCents: general.maxRunCostCents ?? null,
        maxRunTurns: general.maxRunTurns ?? null,
      };
```

Update the company select + literal (`:7327-7331`):

```ts
      const [row] = await db
        .select({ wc: companies.maxRunWallClockMs, cost: companies.maxRunCostCents, turns: companies.maxRunTurns })
        .from(companies)
        .where(eq(companies.id, companyId));
      company = { maxRunWallClockMs: row?.wc ?? null, maxRunCostCents: row?.cost ?? null, maxRunTurns: row?.turns ?? null };
```

Add the stamp to the claim UPDATE `.set({...})` (`:7492`, after `maxRunCostCents`):

```ts
        maxRunCostCents: stampedCaps.maxRunCostCents,
        maxRunTurns: stampedCaps.maxRunTurns,
```

- [ ] **Step 4: Run the test + typecheck to verify**

Run: `cd server && npx vitest run src/__tests__/run-caps-stamp.integration.test.ts`
Expected: PASS (or skipped if embedded Postgres unavailable).
Run: `cd server && pnpm typecheck`
Expected: no errors — every `RunCaps` construction now includes `maxRunTurns`.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/run-caps-stamp.integration.test.ts
git commit -m "feat(heartbeat): stamp per-run turn cap at claim"
```

---

### Task 6: Inject the effective turn limit into the adapter config

**Files:**
- Modify: `server/src/services/heartbeat.ts:190-193` (import), `server/src/services/heartbeat.ts:9055-9058` (`runtimeConfig` assembly)

**Interfaces:**
- Consumes: `applyRunTurnCap` (Task 4), the stamped `run.maxRunTurns` (Task 5 — present on the `run` object because `getRun`/the claim `.returning()` project all `heartbeatRuns` columns), `agent.adapterType`.
- Produces: `runtimeConfig` handed to `adapter.execute` carries the tightened turn field for supported adapters.

- [ ] **Step 1: Import `applyRunTurnCap`**

In `server/src/services/heartbeat.ts`, find the existing import of `resolveRunCaps` from `./run-caps.js` (around `:190-193`) and add `applyRunTurnCap` to it. The named imports must include:

```ts
  applyRunTurnCap,
  resolveRunCaps,
```

(Keep the other names — `RunCaps`, `RunningRunCapRow`, `makeRunCapSweepSource`, `evaluateRunCostCap`, etc. — that are already imported from that module.)

- [ ] **Step 2: Apply the cap at the `runtimeConfig` assembly**

In `server/src/services/heartbeat.ts`, replace the `runtimeConfig` construction (`:9055-9058`):

```ts
    let runtimeConfig = applyRunTurnCap(
      {
        ...effectiveResolvedConfig,
        paperclipRuntimeSkills: runtimeSkillEntries,
      },
      run.maxRunTurns ?? null,
      agent.adapterType,
    );
```

Because `applyRunTurnCap` is generic (`<T>(config: T, ...) => T`), `runtimeConfig` keeps the exact same inferred type it had before — no cast, and every downstream use of `runtimeConfig` typechecks unchanged. The helper returns the input object unchanged for unsupported adapters or when there is nothing to cap, so this is a true no-op in those cases. `agent` is already in scope here (resolved at `:8510`); `run.maxRunTurns` is the value stamped in Task 5 (present on the `run` object because all `heartbeatRuns` columns are projected).

- [ ] **Step 3: Typecheck**

Run: `cd server && pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Run the run-caps + stamp suites to confirm nothing regressed**

Run: `cd server && npx vitest run src/services/run-caps.test.ts src/__tests__/run-caps-stamp.integration.test.ts`
Expected: PASS (stamp suite may be skipped if embedded Postgres unavailable).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/heartbeat.ts
git commit -m "feat(heartbeat): inject effective --max-turns from stamped per-run cap"
```

---

### Task 7: Operator surface — company + instance UI inputs

**Files:**
- Modify: `ui/src/api/companies.ts:61`
- Modify: `ui/src/pages/CompanySettings.tsx:60,73,96-97,115,125,225,446-447`
- Modify: `ui/src/pages/InstanceGeneralSettings.tsx:104,135,141,249-250,277`

**Interfaces:**
- Consumes: `Company.maxRunTurns`, `UpdateCompany.maxRunTurns` (Task 2), `InstanceGeneralSettings.maxRunTurns` (Task 2).
- Produces: operator inputs on both settings pages; empty → `null` (unlimited).

- [ ] **Step 1: Extend the company update payload type**

In `ui/src/api/companies.ts`, immediately after the `maxRunCostCents` line (`:61`):

```ts
      maxRunCostCents?: number | null;
      maxRunTurns?: number | null;
```

- [ ] **Step 2: Add company state + seed + validation + dirty + payload**

In `ui/src/pages/CompanySettings.tsx`:

Add state after `maxRunCostCents` (`:60`):

```ts
  const [maxRunCostCents, setMaxRunCostCents] = useState("");
  const [maxRunTurns, setMaxRunTurns] = useState("");
```

Seed it in the sync effect after `:73`:

```ts
    setMaxRunCostCents(String(selectedCompany.maxRunCostCents ?? ""));
    setMaxRunTurns(String(selectedCompany.maxRunTurns ?? ""));
```

Add validation + payload after the `maxRunCostCentsPayload` block (`:96-97`):

```ts
  const maxRunCostCentsPayload =
    trimmedMaxRunCostCents === "" ? null : Number(trimmedMaxRunCostCents);
  const trimmedMaxRunTurns = maxRunTurns.trim();
  const maxRunTurnsValid =
    trimmedMaxRunTurns === "" ||
    (Number.isInteger(Number(trimmedMaxRunTurns)) && Number(trimmedMaxRunTurns) > 0);
  const maxRunTurnsPayload = trimmedMaxRunTurns === "" ? null : Number(trimmedMaxRunTurns);
```

Extend the dirty check (`:115`, replace the closing line of the `generalDirty` expression):

```ts
      maxRunCostCentsPayload !== (selectedCompany.maxRunCostCents ?? null) ||
      maxRunTurnsPayload !== (selectedCompany.maxRunTurns ?? null));
```

Extend the mutation payload type (`:125`, after `maxRunCostCents`):

```ts
      maxRunCostCents: number | null;
      maxRunTurns: number | null;
```

Extend `handleSaveGeneral` (`:225`, add a trailing field — note the existing last line has no comma, so add one):

```ts
      maxRunCostCents: maxRunCostCentsPayload,
      maxRunTurns: maxRunTurnsPayload
```

- [ ] **Step 3: Add the company input field**

In `ui/src/pages/CompanySettings.tsx`, immediately after the "Max run cost" `Field` closes (`:447`, the `</Field>` following the cost input), insert:

```tsx
              <Field
                label="Max run turns"
                hint="Cap on agent turns for a single run. Only enforced for adapters that support turn limits (Claude, Grok). Empty = unlimited."
              >
                <div className="flex flex-col gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    value={maxRunTurns}
                    onChange={(e) => setMaxRunTurns(e.target.value)}
                    aria-invalid={!maxRunTurnsValid}
                    data-testid="company-max-run-turns-input"
                    className="w-28"
                  />
                  {!maxRunTurnsValid && (
                    <span className="text-xs text-destructive">
                      Enter a positive whole number, or leave empty for unlimited.
                    </span>
                  )}
                </div>
              </Field>
```

Add `!maxRunTurnsValid` to the Save button's `disabled` guard (`:465`, after `!maxRunCostCentsValid`):

```ts
              !maxRunCostCentsValid ||
              !maxRunTurnsValid
```

- [ ] **Step 4: Add instance state + validation + payload + field**

In `ui/src/pages/InstanceGeneralSettings.tsx`:

Add state + seed effect after the `maxRunCostCents` block (`:104`):

```ts
  const [maxRunTurns, setMaxRunTurns] = useState("");
  useEffect(() => {
    setMaxRunTurns(String(generalQuery.data?.maxRunTurns ?? ""));
  }, [generalQuery.data?.maxRunTurns]);
```

Add validation after the `maxRunCostCentsValid` block (`:135`):

```ts
  const trimmedTurns = maxRunTurns.trim();
  const maxRunTurnsValid =
    trimmedTurns === "" || (Number.isInteger(Number(trimmedTurns)) && Number(trimmedTurns) > 0);
```

Extend `saveMaxRuns` (`:141`, after `maxRunCostCents`):

```ts
      maxRunCostCents: trimmedCost === "" ? null : Number(trimmedCost),
      maxRunTurns: trimmedTurns === "" ? null : Number(trimmedTurns),
```

Add the input block after the "Max run cost" wrapper `</div>` (`:250`, immediately before the `<Button ...>` at `:251`):

```tsx
            <div className="w-40">
              <Field
                label="Max run turns"
                hint="Instance-wide cap on agent turns per run. Only enforced for adapters that support turn limits (Claude, Grok). Empty = unlimited."
              >
                <Input
                  type="number"
                  min={1}
                  value={maxRunTurns}
                  onChange={(e) => setMaxRunTurns(e.target.value)}
                  aria-invalid={!maxRunTurnsValid}
                  data-testid="instance-max-run-turns-input"
                />
              </Field>
            </div>
```

Add `!maxRunTurnsValid` to the Save button's `disabled` guard (`:257`, after `!maxRunCostCentsValid`):

```ts
                !maxRunCostCentsValid ||
                !maxRunTurnsValid ||
```

Add a validation message after the `maxRunCostCentsValid` error span (`:277`, after its closing `)}`):

```tsx
          {!maxRunTurnsValid && (
            <span className="text-xs text-destructive">
              Enter a positive whole number of turns, or leave empty for unlimited.
            </span>
          )}
```

- [ ] **Step 5: Typecheck the UI**

Run: `cd ui && pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Run any existing instance settings UI test to confirm no regression**

Run: `cd ui && npx vitest run src/pages/InstanceGeneralSettings.test.tsx`
Expected: PASS (the 2a test file already exists; the new field does not break it).

- [ ] **Step 7: Commit**

```bash
git add ui/src/api/companies.ts ui/src/pages/CompanySettings.tsx ui/src/pages/InstanceGeneralSettings.tsx
git commit -m "feat(ui): per-run turn cap inputs on company + instance settings"
```

---

## Final verification

- [ ] **Full typecheck:** `cd server && pnpm typecheck` and `cd ui && pnpm typecheck` — both clean.
- [ ] **Run-caps suites:** `cd server && npx vitest run src/services/run-caps.test.ts src/__tests__/run-caps-stamp.integration.test.ts src/services/__tests__/instance-settings-run-caps.test.ts` — all PASS (stamp integration may skip without embedded Postgres).
- [ ] **db build:** `pnpm --filter @paperclipai/db build` — clean.
- [ ] **Manual sanity (optional):** set a company `maxRunTurns` of e.g. 5, run a `claude_local` agent, confirm the spawned CLI receives `--max-turns 5` (or the agent's own lower value if smaller), and that a run hitting the limit continues rather than hard-fails.
