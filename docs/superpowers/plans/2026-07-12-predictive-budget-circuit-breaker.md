# Predictive Budget Circuit Breaker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-company circuit breaker that forecasts budget exhaustion (`timeToLimit = remaining budget ÷ rolling burn rate`) and automatically lowers the effective concurrency cap through a graduated warn → throttle → halt ladder before the budget wall, with anti-oscillation hysteresis and self-releasing recovery.

**Architecture:** Enforcement mirrors Phase 2c's panic/drain split — a **stateful evaluator** (`predictive-breaker.ts`, pure + dependency-injected) decides the breaker level per company (ladder + hysteresis), persists it to `company_breaker_state`, and at HALT winds down in-flight runs; a **pure writer** (`predictiveBreakerWriter` in `effective-cap-resolver.ts`) reads the persisted level from `CapContext` and returns the cap. The evaluator runs on the existing heartbeat admission tick. The breaker never flips `runExecutionState`, so manual panic/drain stays human-owned and outranks it.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Zod, Vitest, React (UI). Design spec: `docs/superpowers/specs/2026-07-11-predictive-budget-circuit-breaker-design.md`.

## Global Constraints

- Migrations are **hand-written** (`drizzle-kit generate` unusable — drift past `0098`). Next number is **`0111`**. Add a `.sql` file under `packages/db/src/migrations/` AND a `_journal.json` entry (next `idx` is **111**, `version: "7"`, `breakpoints: true`).
- Company scope only — there is **no instance budget**. Instance resolver sites pass no breaker level.
- Config field names: per-company `predictiveBreakerEnabled` (real column `predictive_breaker_enabled`) and `breakerHorizonMinutes` (real column `breaker_horizon_minutes`). Instance mirrors them as keys in the `general` JSONB — they MUST be added to `instanceGeneralSettingsSchema` AND carried through `normalizeGeneralSettings` in `server/src/services/instance-settings.ts`, else the schema's `.strict()`/normalize drops them.
- Precedence is frozen in `CAP_WRITER_PRECEDENCE` as `["panic-drain", "predictive-breaker", "manual-override", "schedule", "configured-default"]`. The breaker registers at the reserved `"predictive-breaker"` slot. Do not reorder.
- Derived constants (single source, not operator-configurable): ladder `warnMult 2`, `throttleMult 1`, `haltMult 0.25`, `minDwell 10 min`, `burnWindow 15 min`, `upGap 1.5` live in `predictive-breaker.ts`; cap-mapping `throttleFactor 0.5`, `throttleUncappedCap 2` live in `effective-cap-resolver.ts`.
- Wind-down reuses the Phase-2 primitive with a new reason literal `"predictive-breaker-halt"`, `mode: "hard"`, `resume: "when-allowed"` (idempotent — `windDownRun` no-ops on already-stopped runs).

---

## Task 1: DB schema — company columns + `company_breaker_state` table + migration 0111

**Files:**
- Modify: `packages/db/src/schema/companies.ts` (add two columns beside the Phase-2 cap columns ~line 30–38)
- Create: `packages/db/src/schema/company-breaker-state.ts`
- Modify: `packages/db/src/schema/index.ts` (export the new table) — confirm the barrel path; if schema is re-exported from `packages/db/src/schema.ts` instead, add it there
- Create: `packages/db/src/migrations/0111_predictive_breaker.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`

**Interfaces:**
- Produces: `companies.predictiveBreakerEnabled` (boolean, default false), `companies.breakerHorizonMinutes` (integer, nullable); table `companyBreakerState` with columns `companyId` (PK, FK→companies.id cascade), `level` (text, default `'normal'`), `since` (timestamptz), `lastBurnRateCpm` (double precision, nullable), `lastTimeToLimitM` (double precision, nullable), `updatedAt` (timestamptz).

- [ ] **Step 1: Add the company columns**

In `packages/db/src/schema/companies.ts`, directly after the `runExecutionState` column (~line 38):

```ts
    // Combo-01 Phase 3a predictive budget circuit breaker (company override).
    predictiveBreakerEnabled: boolean("predictive_breaker_enabled").notNull().default(false),
    breakerHorizonMinutes: integer("breaker_horizon_minutes"),
```

Confirm `boolean` and `integer` are already imported at the top of the file (they are — `maxConcurrentRuns` uses `integer`, `requireBoardApprovalForNewAgents` uses `boolean`).

- [ ] **Step 2: Create the breaker-state table**

Create `packages/db/src/schema/company-breaker-state.ts`:

```ts
import { doublePrecision, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Combo-01 Phase 3a: persisted per-company breaker level. A row exists only for
// a company the breaker has evaluated. `since` drives the min-dwell hysteresis
// and survives crashes; the last_* columns are observability only.
export const companyBreakerState = pgTable("company_breaker_state", {
  companyId: text("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  level: text("level").notNull().default("normal"),
  since: timestamp("since", { withTimezone: true }).notNull(),
  lastBurnRateCpm: doublePrecision("last_burn_rate_cpm"),
  lastTimeToLimitM: doublePrecision("last_time_to_limit_m"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
```

- [ ] **Step 3: Export the table from the schema barrel**

Find the schema barrel (grep `export .* from "./companies` under `packages/db/src`). Add beside the companies export:

```ts
export * from "./company-breaker-state.js";
```

- [ ] **Step 4: Write the migration**

Create `packages/db/src/migrations/0111_predictive_breaker.sql`:

```sql
ALTER TABLE "companies" ADD COLUMN "predictive_breaker_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "companies" ADD COLUMN "breaker_horizon_minutes" integer;

CREATE TABLE "company_breaker_state" (
	"company_id" text PRIMARY KEY NOT NULL,
	"level" text DEFAULT 'normal' NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"last_burn_rate_cpm" double precision,
	"last_time_to_limit_m" double precision,
	"updated_at" timestamp with time zone NOT NULL
);

ALTER TABLE "company_breaker_state" ADD CONSTRAINT "company_breaker_state_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
```

- [ ] **Step 5: Register the migration in the journal**

In `packages/db/src/migrations/meta/_journal.json`, append to the `entries` array (after `idx` 110). Use a `when` strictly greater than 110's `1781902500000` — use `1781902600000`:

```json
{
  "idx": 111,
  "version": "7",
  "when": 1781902600000,
  "tag": "0111_predictive_breaker",
  "breakpoints": true
}
```

- [ ] **Step 6: Build the db package**

Run: `pnpm --filter @paperclipai/db build`
Expected: clean (TypeScript compiles the new schema file and re-exports).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/companies.ts packages/db/src/schema/company-breaker-state.ts packages/db/src/schema/index.ts packages/db/src/migrations/0111_predictive_breaker.sql packages/db/src/migrations/meta/_journal.json
git commit -m "feat(db): predictive-breaker company config + company_breaker_state table"
```

---

## Task 2: Shared — `BreakerLevel` enum + breaker config on instance & company types

**Files:**
- Create: `packages/shared/src/validators/breaker-level.ts`
- Modify: `packages/shared/src/validators/index.ts` (re-export)
- Modify: `packages/shared/src/validators/instance.ts` (add two fields to `instanceGeneralSettingsSchema`)
- Modify: `packages/shared/src/types/instance.ts` (add two optional fields)
- Modify: `packages/shared/src/types/company.ts` (add two optional fields)
- Modify: `packages/shared/src/index.ts` (export `BreakerLevel`, `breakerLevelSchema`, `BREAKER_LEVELS`)

**Interfaces:**
- Produces: `BREAKER_LEVELS = ["normal","warn","throttle","halt"]`, `breakerLevelSchema` (zod enum), `type BreakerLevel`. Instance + company config fields `predictiveBreakerEnabled?: boolean`, `breakerHorizonMinutes?: number`.

- [ ] **Step 1: Create the breaker-level validator**

Create `packages/shared/src/validators/breaker-level.ts` (mirrors `run-execution-state.ts`):

```ts
import { z } from "zod";

// Combo-01 Phase 3a: predictive-breaker ladder level for a company.
// normal = no cap effect; warn = event only; throttle = reduced cap;
// halt = cap 0 + in-flight runs wound down (reversibly, self-releasing).
export const BREAKER_LEVELS = ["normal", "warn", "throttle", "halt"] as const;
export const breakerLevelSchema = z.enum(BREAKER_LEVELS);
export type BreakerLevel = z.infer<typeof breakerLevelSchema>;
```

- [ ] **Step 2: Re-export from the validators barrel**

In `packages/shared/src/validators/index.ts`, beside the `run-execution-state` re-export, add:

```ts
export * from "./breaker-level.js";
```

- [ ] **Step 3: Add the two fields to the instance general schema**

In `packages/shared/src/validators/instance.ts`, inside `instanceGeneralSettingsSchema` (after `runExecutionState: runExecutionStateSchema.optional(),` ~line 56):

```ts
  predictiveBreakerEnabled: z.boolean().optional(),
  breakerHorizonMinutes: z.number().int().positive().optional(),
```

- [ ] **Step 4: Add the two fields to the instance type**

In `packages/shared/src/types/instance.ts`, after the `runExecutionState?: ...` field (~line 67):

```ts
  predictiveBreakerEnabled?: boolean;
  breakerHorizonMinutes?: number;
```

- [ ] **Step 5: Add the two fields to the company type**

In `packages/shared/src/types/company.ts`, after the `runExecutionState?: ...` field (~line 33):

```ts
  predictiveBreakerEnabled?: boolean;
  breakerHorizonMinutes?: number;
```

- [ ] **Step 6: Export the breaker-level API from the package root**

In `packages/shared/src/index.ts`, beside the `runExecutionStateSchema` / `RunExecutionState` exports, add `BREAKER_LEVELS`, `breakerLevelSchema`, and `type BreakerLevel`. Match the existing export style in that file (value re-export + `type` re-export).

- [ ] **Step 7: Build the shared package**

Run: `pnpm --filter @paperclipai/shared build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/validators/breaker-level.ts packages/shared/src/validators/index.ts packages/shared/src/validators/instance.ts packages/shared/src/types/instance.ts packages/shared/src/types/company.ts packages/shared/src/index.ts
git commit -m "feat(shared): BreakerLevel enum + predictive-breaker config on instance/company"
```

---

## Task 3: Config — carry breaker settings through instance normalize

**Files:**
- Test: `server/src/__tests__/instance-settings-service.test.ts` (add cases)
- Modify: `server/src/services/instance-settings.ts` (`normalizeGeneralSettings`)

**Interfaces:**
- Consumes: `instanceGeneralSettingsSchema` fields from Task 2.
- Produces: `normalizeGeneralSettings` round-trips `predictiveBreakerEnabled` + `breakerHorizonMinutes`.

- [ ] **Step 1: Write the failing test**

In `server/src/__tests__/instance-settings-service.test.ts`, add (match the file's existing describe/import style):

```ts
it("carries predictive-breaker config through normalize", () => {
  const out = normalizeGeneralSettings({
    predictiveBreakerEnabled: true,
    breakerHorizonMinutes: 30,
  });
  expect(out.predictiveBreakerEnabled).toBe(true);
  expect(out.breakerHorizonMinutes).toBe(30);
});

it("omits predictive-breaker config when unset", () => {
  const out = normalizeGeneralSettings({});
  expect(out.predictiveBreakerEnabled).toBeUndefined();
  expect(out.breakerHorizonMinutes).toBeUndefined();
});
```

If `normalizeGeneralSettings` is not already imported/exported in the test, export it from `instance-settings.ts` and import it here (the Phase-2 turn-cap tests already exercise it — follow that import).

- [ ] **Step 2: Run tests to verify they fail (RED)**

Run: `cd server && npx vitest run src/__tests__/instance-settings-service.test.ts -t "predictive-breaker"`
Expected: FAIL — `predictiveBreakerEnabled` comes back `undefined` (the normalize function drops unknown keys).

- [ ] **Step 3: Carry the fields through normalize**

In `server/src/services/instance-settings.ts`, inside `normalizeGeneralSettings`'s success branch, beside the `maxRunTurns` spread:

```ts
      ...(parsed.data.predictiveBreakerEnabled
        ? { predictiveBreakerEnabled: parsed.data.predictiveBreakerEnabled }
        : {}),
      ...(parsed.data.breakerHorizonMinutes
        ? { breakerHorizonMinutes: parsed.data.breakerHorizonMinutes }
        : {}),
```

(There may be a parallel `instanceGeneralSettingsStorageSchema` in this file — if the storage schema is a separate declaration from the shared one, add the two fields there too so `safeParse` retains them.)

- [ ] **Step 4: Run tests to verify they pass (GREEN)**

Run: `cd server && npx vitest run src/__tests__/instance-settings-service.test.ts -t "predictive-breaker"`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/instance-settings.ts server/src/__tests__/instance-settings-service.test.ts
git commit -m "feat(config): carry predictive-breaker settings through instance normalize"
```

---

## Task 4: Resolver — `predictiveBreakerWriter` + `CapContext.breakerLevel`

**Files:**
- Modify: `server/src/services/effective-cap-resolver.ts`
- Test: `server/src/services/effective-cap-resolver.test.ts`

**Interfaces:**
- Consumes: `BreakerLevel` from `@paperclipai/shared`; existing `CapWriter`, `CAP_WRITER_PRECEDENCE`, `panicDrainWriter`, `configuredDefaultWriter`.
- Produces: `CapContext.breakerLevel?: BreakerLevel`; `predictiveBreakerWriter: CapWriter`; `BREAKER_THROTTLE_FACTOR = 0.5`; `BREAKER_THROTTLE_UNCAPPED_CAP = 2`; `PHASE3_COMPANY_WRITERS: CapWriter[]` = `[panicDrainWriter, predictiveBreakerWriter, configuredDefaultWriter]`.

- [ ] **Step 1: Write the failing tests**

In `server/src/services/effective-cap-resolver.test.ts`, add to the existing `describe`:

```ts
it("predictive-breaker: halt forces cap 0", () => {
  expect(predictiveBreakerWriter.resolve({ configuredMax: 10, breakerLevel: "halt" })).toBe(0);
});

it("predictive-breaker: throttle halves a configured cap with a floor of 1", () => {
  expect(predictiveBreakerWriter.resolve({ configuredMax: 10, breakerLevel: "throttle" })).toBe(5);
  expect(predictiveBreakerWriter.resolve({ configuredMax: 1, breakerLevel: "throttle" })).toBe(1);
});

it("predictive-breaker: throttle with no configured cap uses the uncapped fallback", () => {
  expect(predictiveBreakerWriter.resolve({ configuredMax: null, breakerLevel: "throttle" })).toBe(2);
});

it("predictive-breaker: normal/warn/absent are no-opinion", () => {
  expect(predictiveBreakerWriter.resolve({ configuredMax: 10, breakerLevel: "normal" })).toBeNull();
  expect(predictiveBreakerWriter.resolve({ configuredMax: 10, breakerLevel: "warn" })).toBeNull();
  expect(predictiveBreakerWriter.resolve({ configuredMax: 10 })).toBeNull();
});

it("predictive-breaker sits between panic-drain and configured-default", () => {
  // halt from the breaker is overridden by a draining/halted execution state.
  const { source } = resolveEffectiveCap(
    { configuredMax: 10, executionState: "draining", breakerLevel: "throttle" },
    PHASE3_COMPANY_WRITERS,
  );
  expect(source).toBe("panic-drain");
});
```

Add `predictiveBreakerWriter` and `PHASE3_COMPANY_WRITERS` to the import from `./effective-cap-resolver.js`.

- [ ] **Step 2: Run tests to verify they fail (RED)**

Run: `cd server && npx vitest run src/services/effective-cap-resolver.test.ts -t "predictive-breaker"`
Expected: FAIL — `predictiveBreakerWriter` is not exported.

- [ ] **Step 3: Implement the writer + context field**

In `server/src/services/effective-cap-resolver.ts`:

Change the import line to also bring in `BreakerLevel`:

```ts
import type { BreakerLevel, RunExecutionState } from "@paperclipai/shared";
```

Extend `CapContext`:

```ts
export type CapContext = {
  configuredMax: number | null;
  executionState?: RunExecutionState;
  breakerLevel?: BreakerLevel;
};
```

After `panicDrainWriter`, add:

```ts
// Combo-01 Phase 3a: cap-mapping constants (the ladder/hysteresis constants live
// in predictive-breaker.ts; these two are the writer's authority on the cap).
export const BREAKER_THROTTLE_FACTOR = 0.5;
export const BREAKER_THROTTLE_UNCAPPED_CAP = 2;

// Reads the persisted breaker level (decided by the evaluator) and maps it to a
// cap. halt -> 0; throttle -> half the configured cap (floor 1), or the uncapped
// fallback when concurrency is otherwise unlimited; normal/warn/absent -> no opinion.
export const predictiveBreakerWriter: CapWriter = {
  name: "predictive-breaker",
  precedence: CAP_WRITER_PRECEDENCE.indexOf("predictive-breaker"),
  resolve: (ctx) => {
    switch (ctx.breakerLevel) {
      case "halt":
        return 0;
      case "throttle":
        return ctx.configuredMax == null
          ? BREAKER_THROTTLE_UNCAPPED_CAP
          : Math.max(1, Math.floor(ctx.configuredMax * BREAKER_THROTTLE_FACTOR));
      default:
        return null;
    }
  },
};

// Company resolver sites use this set (instance sites have no breaker — no budget).
export const PHASE3_COMPANY_WRITERS: CapWriter[] = [
  panicDrainWriter,
  predictiveBreakerWriter,
  configuredDefaultWriter,
];
```

- [ ] **Step 4: Run tests to verify they pass (GREEN)**

Run: `cd server && npx vitest run src/services/effective-cap-resolver.test.ts`
Expected: PASS (new cases + the existing precedence-lock test still green).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/effective-cap-resolver.ts server/src/services/effective-cap-resolver.test.ts
git commit -m "feat(cap-resolver): predictiveBreakerWriter + breakerLevel context"
```

---

## Task 5: Breaker ladder + hysteresis (pure functions)

**Files:**
- Create: `server/src/services/predictive-breaker.ts`
- Test: `server/src/services/predictive-breaker.test.ts`

**Interfaces:**
- Consumes: `BreakerLevel` from `@paperclipai/shared`.
- Produces:
  - `BREAKER` constants object `{ warnMult, throttleMult, haltMult, minDwellMs, burnWindowMs, upGap }`.
  - `computeTimeToLimit(remainingCents: number, burnRateCpm: number): number` (minutes; `Infinity` when not burning; `0` when `remaining <= 0`).
  - `classifyDownLevel(timeToLimitMin: number, horizonMin: number): BreakerLevel`.
  - `nextLevelWithHysteresis(current: BreakerLevel, since: Date, timeToLimitMin: number, horizonMin: number, now: Date): BreakerLevel`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/services/predictive-breaker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BREAKER,
  classifyDownLevel,
  computeTimeToLimit,
  nextLevelWithHysteresis,
} from "./predictive-breaker.js";

const H = 40; // horizon minutes -> halt<=10, throttle<=40, warn<=80
const T0 = new Date("2026-07-12T00:00:00Z");
const afterDwell = new Date(T0.getTime() + BREAKER.minDwellMs + 1);
const beforeDwell = new Date(T0.getTime() + BREAKER.minDwellMs - 1);

describe("computeTimeToLimit", () => {
  it("is Infinity when not burning", () => {
    expect(computeTimeToLimit(1000, 0)).toBe(Infinity);
  });
  it("is 0 when remaining is exhausted", () => {
    expect(computeTimeToLimit(0, 5)).toBe(0);
    expect(computeTimeToLimit(-10, 5)).toBe(0);
  });
  it("is remaining / burnRate in minutes otherwise", () => {
    expect(computeTimeToLimit(100, 5)).toBe(20);
  });
});

describe("classifyDownLevel", () => {
  it("maps timeToLimit to the right rung", () => {
    expect(classifyDownLevel(200, H)).toBe("normal"); // > 2H (80)
    expect(classifyDownLevel(70, H)).toBe("warn"); // <= 2H, > H
    expect(classifyDownLevel(30, H)).toBe("throttle"); // <= H, > H/4
    expect(classifyDownLevel(5, H)).toBe("halt"); // <= H/4 (10)
    expect(classifyDownLevel(0, H)).toBe("halt"); // exhausted
  });
});

describe("nextLevelWithHysteresis", () => {
  it("escalates immediately, jumping multiple rungs", () => {
    expect(nextLevelWithHysteresis("normal", T0, 5, H, afterDwell)).toBe("halt");
  });
  it("does not de-escalate before min dwell even when recovered", () => {
    // tt=200 (fully recovered) but only 'beforeDwell' has elapsed
    expect(nextLevelWithHysteresis("throttle", T0, 200, H, beforeDwell)).toBe("throttle");
  });
  it("does not de-escalate until timeToLimit clears the gapped up-threshold", () => {
    // throttle->warn needs tt > H*upGap = 60; here tt=50 (still <=60) though dwell met
    expect(nextLevelWithHysteresis("throttle", T0, 50, H, afterDwell)).toBe("throttle");
  });
  it("de-escalates ONE rung when dwell met and tt clears the gap", () => {
    // throttle->warn: tt > 60 and dwell met -> warn (not straight to normal)
    expect(nextLevelWithHysteresis("throttle", T0, 200, H, afterDwell)).toBe("warn");
  });
  it("de-escalates halt->throttle first", () => {
    // halt->throttle needs tt > (H/4)*upGap = 15; tt=200, dwell met
    expect(nextLevelWithHysteresis("halt", T0, 200, H, afterDwell)).toBe("throttle");
  });
  it("holds when the raw level equals the current level", () => {
    expect(nextLevelWithHysteresis("throttle", T0, 30, H, afterDwell)).toBe("throttle");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (RED)**

Run: `cd server && npx vitest run src/services/predictive-breaker.test.ts`
Expected: FAIL — module `./predictive-breaker.js` not found.

- [ ] **Step 3: Implement the pure functions**

Create `server/src/services/predictive-breaker.ts`:

```ts
// Combo-01 Phase 3a: predictive budget circuit breaker — pure ladder + hysteresis.
// The evaluator (below, dependency-injected) drives these; the cap-mapping lives
// in effective-cap-resolver.ts. No DB or clock access here — `now` is passed in.
import type { BreakerLevel } from "@paperclipai/shared";

export const BREAKER = {
  warnMult: 2, // warn when timeToLimit <= 2H
  throttleMult: 1, // throttle when timeToLimit <= H
  haltMult: 0.25, // halt when timeToLimit <= H/4
  minDwellMs: 10 * 60_000, // hold a level >= 10 min before de-escalating
  burnWindowMs: 15 * 60_000, // rolling window for the burn rate
  upGap: 1.5, // de-escalation up-threshold = down-threshold * upGap
} as const;

const SEVERITY: Record<BreakerLevel, number> = { normal: 0, warn: 1, throttle: 2, halt: 3 };
const ONE_RUNG_BELOW: Record<BreakerLevel, BreakerLevel> = {
  halt: "throttle",
  throttle: "warn",
  warn: "normal",
  normal: "normal",
};

// minutes; Infinity when not burning; 0 when the budget is already exhausted.
export function computeTimeToLimit(remainingCents: number, burnRateCpm: number): number {
  if (remainingCents <= 0) return 0;
  if (burnRateCpm <= 0) return Infinity;
  return remainingCents / burnRateCpm;
}

// The rung the raw timeToLimit warrants right now (no hysteresis). Most-severe first.
export function classifyDownLevel(timeToLimitMin: number, horizonMin: number): BreakerLevel {
  if (timeToLimitMin <= horizonMin * BREAKER.haltMult) return "halt";
  if (timeToLimitMin <= horizonMin * BREAKER.throttleMult) return "throttle";
  if (timeToLimitMin <= horizonMin * BREAKER.warnMult) return "warn";
  return "normal";
}

// The down-threshold boundary (in minutes) at which `level` becomes active.
function downThreshold(level: BreakerLevel, horizonMin: number): number {
  switch (level) {
    case "halt":
      return horizonMin * BREAKER.haltMult;
    case "throttle":
      return horizonMin * BREAKER.throttleMult;
    case "warn":
      return horizonMin * BREAKER.warnMult;
    default:
      return Infinity;
  }
}

// Escalate immediately (may jump rungs). De-escalate one rung per call, and only
// when BOTH the min-dwell has elapsed AND timeToLimit has cleared the gapped
// up-threshold for the current level.
export function nextLevelWithHysteresis(
  current: BreakerLevel,
  since: Date,
  timeToLimitMin: number,
  horizonMin: number,
  now: Date,
): BreakerLevel {
  const raw = classifyDownLevel(timeToLimitMin, horizonMin);
  if (SEVERITY[raw] > SEVERITY[current]) return raw; // escalate now
  if (SEVERITY[raw] === SEVERITY[current]) return current; // hold

  const dwellMet = now.getTime() - since.getTime() >= BREAKER.minDwellMs;
  const upThreshold = downThreshold(current, horizonMin) * BREAKER.upGap;
  if (dwellMet && timeToLimitMin > upThreshold) return ONE_RUNG_BELOW[current];
  return current; // not yet safe to relax
}
```

- [ ] **Step 4: Run tests to verify they pass (GREEN)**

Run: `cd server && npx vitest run src/services/predictive-breaker.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/predictive-breaker.ts server/src/services/predictive-breaker.test.ts
git commit -m "feat(predictive-breaker): pure ladder + hysteresis functions"
```

---

## Task 6: Breaker evaluator (dependency-injected orchestration)

**Files:**
- Modify: `server/src/services/predictive-breaker.ts` (add the evaluator + deps)
- Modify: `server/src/services/run-wind-down.ts` (add the reason literal)
- Test: `server/src/services/predictive-breaker.test.ts` (add evaluator cases)

**Interfaces:**
- Consumes: `computeTimeToLimit`, `nextLevelWithHysteresis` (Task 5); `BreakerLevel`.
- Produces:
  - `WindDownReason` gains `"predictive-breaker-halt"`.
  - `type BreakerEvalDeps` (below).
  - `evaluateCompanyBreaker(deps: BreakerEvalDeps, companyId: string, horizonMinutes: number, now: Date): Promise<BreakerLevel>` — computes the level, persists state, logs transitions, and winds down in-flight runs at HALT. Returns the resolved level.

- [ ] **Step 1: Add the wind-down reason literal**

In `server/src/services/run-wind-down.ts`, extend the union (line 12):

```ts
export type WindDownReason = "cap-wallclock" | "cap-cost" | "panic" | "drain" | "predictive-breaker-halt";
```

- [ ] **Step 2: Write the failing tests**

Append to `server/src/services/predictive-breaker.test.ts`:

```ts
import { evaluateCompanyBreaker, type BreakerEvalDeps } from "./predictive-breaker.js";

function fakeDeps(over: Partial<BreakerEvalDeps> & {
  burn?: number;
  remaining?: number | null;
  state?: { level: BreakerLevel; since: Date } | null;
}): { deps: BreakerEvalDeps; saved: Array<{ level: BreakerLevel }>; wound: string[]; logs: Array<[BreakerLevel, BreakerLevel]> } {
  const saved: Array<{ level: BreakerLevel }> = [];
  const wound: string[] = [];
  const logs: Array<[BreakerLevel, BreakerLevel]> = [];
  const deps: BreakerEvalDeps = {
    getBurnRateCentsPerMin: async () => over.burn ?? 0,
    getMostUrgentRemainingCents: async () => (over.remaining === undefined ? 1000 : over.remaining),
    loadState: async () => over.state ?? null,
    saveState: async (_c, row) => {
      saved.push({ level: row.level });
    },
    windDownCompanyRuns: async (companyId) => {
      wound.push(companyId);
    },
    logTransition: async (_c, from, to) => {
      logs.push([from, to]);
    },
    ...over,
  };
  return { deps, saved, wound, logs };
}

describe("evaluateCompanyBreaker", () => {
  it("returns normal and does not wind down when not burning", async () => {
    const { deps, wound } = fakeDeps({ burn: 0, remaining: 1000 });
    const level = await evaluateCompanyBreaker(deps, "c1", 40, T0);
    expect(level).toBe("normal");
    expect(wound).toEqual([]);
  });

  it("escalates to halt and winds down when the budget is nearly gone", async () => {
    // remaining 10, burn 5/min -> tt=2 <= H/4(10) -> halt
    const { deps, wound, logs } = fakeDeps({ burn: 5, remaining: 10 });
    const level = await evaluateCompanyBreaker(deps, "c1", 40, T0);
    expect(level).toBe("halt");
    expect(wound).toEqual(["c1"]);
    expect(logs).toContainEqual(["normal", "halt"]);
  });

  it("winds down every tick while halted (idempotent backstop)", async () => {
    const { deps, wound } = fakeDeps({ burn: 5, remaining: 10, state: { level: "halt", since: T0 } });
    await evaluateCompanyBreaker(deps, "c1", 40, new Date(T0.getTime() + 60_000));
    expect(wound).toEqual(["c1"]); // still winds down while the level stays halt
  });

  it("resets to normal and skips wind-down when the company is ineligible", async () => {
    const { deps, wound } = fakeDeps({ remaining: null, state: { level: "throttle", since: T0 } });
    const level = await evaluateCompanyBreaker(deps, "c1", 40, T0);
    expect(level).toBe("normal");
    expect(wound).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail (RED)**

Run: `cd server && npx vitest run src/services/predictive-breaker.test.ts -t "evaluateCompanyBreaker"`
Expected: FAIL — `evaluateCompanyBreaker` / `BreakerEvalDeps` not exported.

- [ ] **Step 4: Implement the evaluator**

Append to `server/src/services/predictive-breaker.ts`:

```ts
export type BreakerEvalDeps = {
  // Rolling windowed burn rate (cents/min) over BREAKER.burnWindowMs.
  getBurnRateCentsPerMin(companyId: string): Promise<number>;
  // Remaining cents of the MOST URGENT active company-scoped billed_cents budget
  // (min remaining across policies). null => the company is ineligible (no budget).
  getMostUrgentRemainingCents(companyId: string): Promise<number | null>;
  loadState(companyId: string): Promise<{ level: BreakerLevel; since: Date } | null>;
  saveState(
    companyId: string,
    row: { level: BreakerLevel; since: Date; lastBurnRateCpm: number; lastTimeToLimitM: number | null },
  ): Promise<void>;
  windDownCompanyRuns(companyId: string): Promise<void>;
  logTransition(
    companyId: string,
    from: BreakerLevel,
    to: BreakerLevel,
    ctx: { burnRateCpm: number; timeToLimitMin: number; remainingCents: number },
  ): Promise<void>;
};

export async function evaluateCompanyBreaker(
  deps: BreakerEvalDeps,
  companyId: string,
  horizonMinutes: number,
  now: Date,
): Promise<BreakerLevel> {
  const remaining = await deps.getMostUrgentRemainingCents(companyId);
  const prev = (await deps.loadState(companyId)) ?? { level: "normal" as BreakerLevel, since: now };

  // Ineligible (no budget): relax to normal. Persist only if we were non-normal.
  if (remaining === null) {
    if (prev.level !== "normal") {
      await deps.saveState(companyId, {
        level: "normal",
        since: now,
        lastBurnRateCpm: 0,
        lastTimeToLimitM: null,
      });
      await deps.logTransition(companyId, prev.level, "normal", {
        burnRateCpm: 0,
        timeToLimitMin: Infinity,
        remainingCents: 0,
      });
    }
    return "normal";
  }

  const burn = await deps.getBurnRateCentsPerMin(companyId);
  const tt = computeTimeToLimit(remaining, burn);
  const next = nextLevelWithHysteresis(prev.level, prev.since, tt, horizonMinutes, now);

  await deps.saveState(companyId, {
    level: next,
    since: next === prev.level ? prev.since : now,
    lastBurnRateCpm: burn,
    lastTimeToLimitM: Number.isFinite(tt) ? tt : null,
  });
  if (next !== prev.level) {
    await deps.logTransition(companyId, prev.level, next, {
      burnRateCpm: burn,
      timeToLimitMin: tt,
      remainingCents: remaining,
    });
  }
  // Wind down EVERY tick while halted — idempotent, and the crash-safe backstop.
  if (next === "halt") await deps.windDownCompanyRuns(companyId);
  return next;
}
```

- [ ] **Step 5: Run tests to verify they pass (GREEN)**

Run: `cd server && npx vitest run src/services/predictive-breaker.test.ts`
Expected: PASS (pure + evaluator cases).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/predictive-breaker.ts server/src/services/predictive-breaker.test.ts server/src/services/run-wind-down.ts
git commit -m "feat(predictive-breaker): DI evaluator — state, transitions, halt wind-down"
```

---

## Task 7: Heartbeat wiring — burn/remaining deps, evaluator on the tick, breaker level into the resolver

**Files:**
- Modify: `server/src/services/heartbeat.ts`

**Interfaces:**
- Consumes: `evaluateCompanyBreaker`, `BreakerEvalDeps`, `BREAKER` (Task 5/6); `PHASE3_COMPANY_WRITERS`, `CapContext` (Task 4); `companyBreakerState` schema (Task 1); `windDownRun`, `logActivity`, `budgetPolicies`/`costEvents` (existing).
- Produces: `AdmissionStatus.breakerLevel`; company resolver sites resolve with `PHASE3_COMPANY_WRITERS` and a loaded `breakerLevel`; a per-company breaker evaluation runs on the admission tick; helper `loadCompanyBreakerLevel(companyId)`.

- [ ] **Step 1: Extend the `AdmissionStatus` type**

In `server/src/services/heartbeat.ts`, add to `AdmissionStatus` (~line 3406, after `runExecutionState`):

```ts
  breakerLevel: BreakerLevel;
```

Add `BreakerLevel` to the `@paperclipai/shared` import, and import the new pieces near the resolver import (~line 180):

```ts
import {
  resolveEffectiveCap,
  PHASE1_WRITERS,
  PHASE3_COMPANY_WRITERS,
} from "./effective-cap-resolver.js";
import {
  BREAKER,
  evaluateCompanyBreaker,
  type BreakerEvalDeps,
} from "./predictive-breaker.js";
import { companyBreakerState } from "@paperclipai/db"; // adjust to the actual schema export path
```

- [ ] **Step 2: Add the breaker deps + evaluator invocation**

Add these helpers inside `heartbeatService` (near `getCompanyMaxConcurrentRuns` ~line 7308). Adjust table/column imports to match the codebase's Drizzle access style (follow how `budgets.ts` queries `costEvents` and `budgetPolicies`).

```ts
  // Rolling windowed burn rate (cents/min) over the last BREAKER.burnWindowMs.
  async function getBurnRateCentsPerMin(companyId: string): Promise<number> {
    const windowStart = new Date(Date.now() - BREAKER.burnWindowMs);
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision` })
      .from(costEvents)
      .where(and(eq(costEvents.companyId, companyId), gte(costEvents.occurredAt, windowStart)));
    const windowMin = BREAKER.burnWindowMs / 60_000;
    return Number(row?.total ?? 0) / windowMin;
  }

  // Min remaining cents across active company-scoped billed_cents policies with a
  // finite budget. null => ineligible (no such policy). Reuses the same observed-
  // spend logic budgets.ts uses (amount - sum(cost_events in window)).
  async function getMostUrgentRemainingCents(companyId: string): Promise<number | null> {
    const policies = await db
      .select()
      .from(budgetPolicies)
      .where(
        and(
          eq(budgetPolicies.companyId, companyId),
          eq(budgetPolicies.scopeType, "company"),
          eq(budgetPolicies.metric, "billed_cents"),
        ),
      );
    let min: number | null = null;
    for (const p of policies) {
      if (!p.amount || p.amount <= 0) continue;
      const observed = await computeObservedSpendForPolicy(companyId, p); // mirror budgets.ts computeObservedAmount
      const remaining = Math.max(0, p.amount - observed);
      min = min === null ? remaining : Math.min(min, remaining);
    }
    return min;
  }

  async function loadCompanyBreakerLevel(companyId: string): Promise<BreakerLevel> {
    const [row] = await db
      .select({ level: companyBreakerState.level })
      .from(companyBreakerState)
      .where(eq(companyBreakerState.companyId, companyId));
    return (row?.level as BreakerLevel) ?? "normal";
  }

  const breakerDeps: BreakerEvalDeps = {
    getBurnRateCentsPerMin,
    getMostUrgentRemainingCents,
    loadState: async (companyId) => {
      const [row] = await db
        .select({ level: companyBreakerState.level, since: companyBreakerState.since })
        .from(companyBreakerState)
        .where(eq(companyBreakerState.companyId, companyId));
      return row ? { level: row.level as BreakerLevel, since: row.since } : null;
    },
    saveState: async (companyId, r) => {
      await db
        .insert(companyBreakerState)
        .values({
          companyId,
          level: r.level,
          since: r.since,
          lastBurnRateCpm: r.lastBurnRateCpm,
          lastTimeToLimitM: r.lastTimeToLimitM,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: companyBreakerState.companyId,
          set: {
            level: r.level,
            since: r.since,
            lastBurnRateCpm: r.lastBurnRateCpm,
            lastTimeToLimitM: r.lastTimeToLimitM,
            updatedAt: new Date(),
          },
        });
    },
    windDownCompanyRuns: async (companyId) => {
      const rows = await db
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.status, "running")));
      for (const row of rows) {
        await windDownRun(row.id, { mode: "hard", resume: "when-allowed", reason: "predictive-breaker-halt" });
      }
    },
    logTransition: async (companyId, from, to, ctx) => {
      await logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "predictive-breaker",
        action: "admission.breaker_transition",
        entityType: "company",
        entityId: companyId,
        details: { from, to, ...ctx },
      });
    },
  };

  // Evaluate one company's breaker (enabled + horizon resolved from company/instance).
  async function evaluateBreakerForCompany(companyId: string): Promise<void> {
    const enabled = await isBreakerEnabledForCompany(companyId); // company flag OR instance default
    if (!enabled) return;
    const horizon = await getBreakerHorizonForCompany(companyId); // company value ?? instance default
    if (!horizon || horizon <= 0) return;
    await evaluateCompanyBreaker(breakerDeps, companyId, horizon, new Date());
  }
```

Implement `computeObservedSpendForPolicy`, `isBreakerEnabledForCompany`, and `getBreakerHorizonForCompany` following the existing company/instance-settings read helpers (`getCompanyMaxConcurrentRuns` for the column read pattern; `instanceSettingsService(db).getGeneral()` for the instance default). Resolution rule: **company value if set, else instance default, else disabled**.

- [ ] **Step 3: Call the evaluator on the admission tick**

In the admission pass that iterates companies/agents (around the claim loop ~8500), before resolving the company cap, evaluate the breaker so the freshly-persisted level is read by the resolver in the same tick:

```ts
      await evaluateBreakerForCompany(agent.companyId);
```

Wrap in try/catch and **fail open** (log a warning, continue) — identical to the existing instance/company cap-lookup fail-open blocks at ~8508–8532. A breaker evaluation failure must never block admission.

- [ ] **Step 4: Thread `breakerLevel` into the company resolver sites**

At the two **company** resolver sites (`getCompanyAdmissionStatus` ~7453, where the id is `companyId`, and the claim-path company cap ~8523, where the id is `agent.companyId`), switch to `PHASE3_COMPANY_WRITERS` and pass the loaded level (substitute the correct id variable at each site):

```ts
    const breakerLevel = await loadCompanyBreakerLevel(companyId);
    const { cap, source } = resolveEffectiveCap(
      {
        configuredMax: await getCompanyMaxConcurrentRuns(companyId),
        executionState: runExecutionState,
        breakerLevel,
      },
      PHASE3_COMPANY_WRITERS,
    );
```

Return `breakerLevel` in `getCompanyAdmissionStatus`'s `AdmissionStatus`. The two **instance** sites keep `PHASE1_WRITERS` and set `breakerLevel: "normal"` in their returned `AdmissionStatus` (no instance budget).

- [ ] **Step 5: Typecheck**

Run: `cd server && pnpm typecheck`
Expected: clean. Resolve any Drizzle import-path or column-name mismatches against the actual schema exports.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/heartbeat.ts
git commit -m "feat(heartbeat): evaluate predictive breaker on admission tick + thread level into resolver"
```

---

## Task 8: Integration test — forecast lowers the cap before the wall, no oscillation, halt + auto-release

**Files:**
- Create: `server/src/__tests__/predictive-breaker.integration.test.ts`

**Interfaces:**
- Consumes: `evaluateCompanyBreaker` + a real DB-backed `BreakerEvalDeps` (or the heartbeat service), embedded Postgres per existing integration suites.

- [ ] **Step 1: Write the integration test**

Model it on `server/src/__tests__/panic-drain.integration.test.ts` (same embedded-PG bootstrap + skip-without-PG guard). Cover, seeding `cost_events` + a company-scoped `billed_cents` `budget_policies` row:

```ts
// Pseudocode of the assertions — fill in with the suite's real harness:
// 1. High burn, remaining small -> evaluate -> company_breaker_state.level === "throttle"
//    and the company AdmissionStatus.cap === floor(configuredCap * 0.5) BEFORE spend hits amount.
// 2. Nearly-exhausted remaining -> evaluate -> level "halt", cap 0, in-flight running runs
//    transition to wound-down (status reflects windDownRun).
// 3. Jitter: alternate tt just above/below a threshold across ticks within min-dwell ->
//    level does NOT oscillate (stays at the escalated rung until dwell + gap clear).
// 4. Burn subsides (tt well above gapped up-threshold) + advance clock past min-dwell across
//    ticks -> level steps halt -> throttle -> warn -> normal (cap rises monotonically).
```

- [ ] **Step 2: Run the integration test**

Run: `cd server && npx vitest run src/__tests__/predictive-breaker.integration.test.ts`
Expected: PASS (or SKIP cleanly when embedded Postgres is unavailable, matching the panic-drain suite's guard).

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/predictive-breaker.integration.test.ts
git commit -m "test(predictive-breaker): integration — throttle-before-wall, no oscillation, halt+auto-release"
```

---

## Task 9: UI — breaker badge + per-company/instance config

**Files:**
- Modify: `ui/src/api/instanceSettings.ts` (`AdmissionStatus` type + settings shape)
- Modify: `ui/src/components/AdmissionStatusLine.tsx` (+ its test)
- Modify: `ui/src/pages/CompanySettings.tsx`
- Modify: `ui/src/pages/InstanceGeneralSettings.tsx`

**Interfaces:**
- Consumes: `AdmissionStatus.breakerLevel` from the server; the two new settings fields.
- Produces: a breaker badge when `breakerLevel !== "normal"`; enable toggle + horizon input on both settings pages.

- [ ] **Step 1: Extend the UI `AdmissionStatus` type**

In `ui/src/api/instanceSettings.ts` (~line 27), add `breakerLevel` to `AdmissionStatus`:

```ts
  breakerLevel: "normal" | "warn" | "throttle" | "halt";
```

Add `predictiveBreakerEnabled?: boolean` and `breakerHorizonMinutes?: number` to the instance general-settings type in this file, and the equivalent to the company-settings API type (mirror where `maxConcurrentRuns` / `runExecutionState` live).

- [ ] **Step 2: Render the breaker badge**

In `ui/src/components/AdmissionStatusLine.tsx`, extend the existing execution-state badge logic. Show the breaker level (when not `normal`) using the same muted/destructive treatment as the drain badge; `halt`/`throttle` use `text-destructive`, `warn` a warning tone:

```tsx
  const breakerBadge =
    status.breakerLevel && status.breakerLevel !== "normal" ? (
      <span className="ml-1 font-medium text-destructive">· breaker: {status.breakerLevel}</span>
    ) : null;
```

Render `breakerBadge` beside the existing `stateBadge`. Update `AdmissionStatusLine.test.tsx`: add `breakerLevel: "normal"` to existing fixtures so they type-check, and add one case asserting the badge renders for `"throttle"`.

- [ ] **Step 3: Add config controls to both settings pages**

In `ui/src/pages/CompanySettings.tsx` and `ui/src/pages/InstanceGeneralSettings.tsx`, beside the existing per-run cap / execution-state controls, add an enable checkbox bound to `predictiveBreakerEnabled` and a positive-integer input bound to `breakerHorizonMinutes`, wired to the same mutation pattern as the existing settings fields on each page (follow `maxConcurrentRuns` / `maxRunTurns`). Label the horizon "Budget breaker horizon (minutes)" with helper text "Lower the cap when the budget is forecast to run out within this many minutes."

- [ ] **Step 4: Typecheck + run settings tests**

Run: `cd ui && pnpm typecheck`
Expected: clean.
Run: `cd ui && npx vitest run src/components/AdmissionStatusLine.test.tsx src/pages/InstanceGeneralSettings.test.tsx src/pages/CompanySettings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/api/instanceSettings.ts ui/src/components/AdmissionStatusLine.tsx ui/src/components/AdmissionStatusLine.test.tsx ui/src/pages/CompanySettings.tsx ui/src/pages/InstanceGeneralSettings.tsx
git commit -m "feat(ui): predictive-breaker badge + enable/horizon controls"
```

---

## Final verification

- [ ] **Full typecheck:** `cd server && pnpm typecheck` and `cd ui && pnpm typecheck` — both clean.
- [ ] **db build:** `pnpm --filter @paperclipai/db build` — clean.
- [ ] **Breaker suites:** `cd server && npx vitest run src/services/predictive-breaker.test.ts src/services/effective-cap-resolver.test.ts src/__tests__/instance-settings-service.test.ts src/__tests__/predictive-breaker.integration.test.ts` — all PASS (integration may skip without embedded Postgres).
- [ ] **UI suites:** `cd ui && npx vitest run src/components/AdmissionStatusLine.test.tsx src/pages/InstanceGeneralSettings.test.tsx src/pages/CompanySettings.test.tsx` — all PASS.
- [ ] **Manual sanity (optional):** enable the breaker on a company with a small monthly budget; drive spend so `timeToLimit` falls below 2×horizon (WARN event), then below horizon (cap halves — `AdmissionStatus.source` reads `predictive-breaker`), then near-exhausted (cap 0, in-flight runs wind down). Let burn subside and confirm the level steps back up over successive ticks. Confirm a manual Panic still overrides the breaker (source reads `panic-drain`).
