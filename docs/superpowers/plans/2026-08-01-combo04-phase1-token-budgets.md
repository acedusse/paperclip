# Combo 04 Phase 1 — Token Budgets + Cache-Hit Metric Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make token usage a first-class, enforceable budget metric alongside dollars, and surface prompt-cache hit rate from token data already collected.

**Architecture:** The budget engine in `server/src/services/budgets.ts` is already generic over `budget_policies.metric` — thresholds, incidents, approvals, pause and resume all operate on `amount` vs `observedAmount` without reference to units. Five sites pin it to dollars. This plan removes those pins, widens the amount columns to `bigint`, adds a shared metric-descriptor table so the UI stops hardcoding dollar formatting, and adds a pure cache-hit-rate function derived client-side from data the costs API already returns.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Express, Zod, React 18 + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-01-combo04-phase1-token-budgets-design.md`

**Branch:** `feat/combo04-phase1-token-budgets` (already cut off `master` @ `e8e001c`)

## Global Constraints

- **Migrations are hand-written raw SQL.** Never run `drizzle-kit generate` — the snapshot baseline is stale at `0098` and generate emits a destructive bundle. Write `packages/db/src/migrations/NNNN_name.sql` plus a matching `meta/_journal.json` entry with `idx` = the number.
- **Shared symbols need TWO exports.** Anything added to `packages/shared/src/<module>.ts` or `constants.ts` must also be re-exported from the top-level `packages/shared/src/index.ts` barrel. Server code imports from `@paperclipai/shared`; a symbol in only one barrel resolves to `undefined` at runtime.
- **UI tests use no `@testing-library/react`** — it is not installed. Use a `// @vitest-environment jsdom` header, set `(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true`, render via `react-dom/client` `createRoot` wrapped in React's `act(...)`, and assert on the DOM. Model: `ui/src/pages/ApprovalDetail.autoApprove.test.tsx`.
- **Embedded-postgres tests** use `getEmbeddedPostgresTestSupport` / `startEmbeddedPostgresTestDatabase` from `server/src/__tests__/helpers/embedded-postgres.js`, guarded by `describeEmbeddedPostgres`. Model: `server/src/services/delegation.test.ts`. Tear down with the returned `cleanup`, not `stop()`.
- **`companies.issuePrefix` is uniquely indexed** — seeding two companies in one test needs distinct prefixes.
- **No new route files** are created by this plan, so `server/src/__tests__/openapi-routes.test.ts` needs no changes.
- **There is no structured logger** in `server/src/services/`. Do not add `console.warn` to a production service path; use a code comment where the spec says "logs a warning".
- Every touched file keeps its existing `[START: module]` / `[END: module]` header block intact.
- Commit after every task. One commit per task.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/db/src/migrations/0123_combo04_token_budget_amounts.sql` | **Create.** Widen three amount columns to `bigint`. | 1 |
| `packages/db/src/migrations/meta/_journal.json` | **Modify.** Journal entry `idx: 123`. | 1 |
| `packages/db/src/schema/budget_policies.ts` | **Modify.** `amount` → `bigint({ mode: "number" })`. | 1 |
| `packages/db/src/schema/budget_incidents.ts` | **Modify.** `amountLimit` / `amountObserved` → `bigint`. | 1 |
| `server/src/services/budgets.ts` | **Modify.** Metric-generic observed-amount expression; drop the `evaluateCostEvent` filter; collapse three scope lookups into `findBlockingPolicy`. | 2, 3 |
| `server/src/services/budgets.token-metric.test.ts` | **Create.** Embedded-postgres: token aggregation, mixed scope, hard stop, bigint round-trip. | 2, 3 |
| `server/src/__tests__/budgets-service.test.ts` | **Unchanged — regression check only.** Stub-based (`createDbStub`), so it verifies dispatch, not SQL. Must keep passing untouched. | 2, 3 |
| `packages/shared/src/constants.ts` | **Modify.** `total_tokens` in `BUDGET_METRICS`; `BudgetMetricMeta` + `BUDGET_METRIC_META`. | 4 |
| `packages/shared/src/validators/budget.ts` | **Modify.** Upper bound on `amount`. | 4 |
| `packages/shared/src/index.ts` | **Modify.** Barrel exports for tasks 4 and 7. | 4, 7 |
| `packages/shared/src/budget-metrics.test.ts` | **Create.** Descriptor completeness. | 4 |
| `ui/src/lib/utils.ts` | **Modify.** `formatBudgetAmount(metric, amount)`. | 5 |
| `ui/src/components/BudgetPolicyCard.tsx` | **Modify.** Descriptor-driven formatting, parsing, copy. | 5 |
| `ui/src/components/BudgetIncidentCard.tsx` | **Modify.** Same, plus metric-aware raise default. | 5 |
| `ui/src/components/ApprovalPayload.tsx` | **Modify.** Same, plus metric label. | 5 |
| `ui/src/pages/Costs.tsx` | **Modify.** Pass `metric` on upsert (bug fix); cache-hit display. | 5, 8 |
| `ui/src/components/BudgetPolicyCard.test.tsx` | **Create.** Both units render correctly. | 5 |
| `ui/src/pages/AgentDetail.tsx` | **Modify.** dollars\|tokens toggle. | 6 |
| `ui/src/pages/ProjectDetail.tsx` | **Modify.** dollars\|tokens toggle. | 6 |
| `packages/shared/src/cache-metrics.ts` | **Create.** `computeCacheHitRate`. | 7 |
| `packages/shared/src/cache-metrics.test.ts` | **Create.** Bands, floor, edge cases. | 7 |
| `ui/src/pages/Costs.cacheHitRate.test.tsx` | **Create.** Company + per-agent display. | 8 |

**Task dependency:** 1 → 2 → 3 → 4 → 5 → 6. Tasks 7 → 8 are independent of 1–6 and may run in parallel.

---

### Task 1: Widen budget amount columns to bigint

The `integer` ceiling is 2 147 483 647 — ample for cents ($21.4 M), reachable for a monthly token budget on a real fleet, where it fails as a Postgres `integer out of range` error at insert. `agent_runtime_state` already stores token totals as `bigint({ mode: "number" })`; this converges on that.

**Files:**
- Create: `packages/db/src/migrations/0123_combo04_token_budget_amounts.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/budget_policies.ts:15` (import), `:27` (`amount`)
- Modify: `packages/db/src/schema/budget_incidents.ts:34-35`

**Interfaces:**
- Consumes: nothing.
- Produces: `budgetPolicies.amount`, `budgetIncidents.amountLimit`, `budgetIncidents.amountObserved` all typed `number` in TS (unchanged) but backed by `bigint` in Postgres. No signature changes for consumers.

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/src/migrations/0123_combo04_token_budget_amounts.sql`:

```sql
ALTER TABLE "budget_policies" ALTER COLUMN "amount" TYPE bigint;
--> statement-breakpoint
ALTER TABLE "budget_incidents" ALTER COLUMN "amount_limit" TYPE bigint;
--> statement-breakpoint
ALTER TABLE "budget_incidents" ALTER COLUMN "amount_observed" TYPE bigint;
```

Widening `integer` → `bigint` is always safe: every `int4` value is representable as `int8`, so no data can be lost and no `USING` clause is needed. These statements are not wrapped in `IF NOT EXISTS` guards because `ALTER COLUMN … TYPE` to the type a column already has is a no-op in Postgres, not an error.

- [ ] **Step 2: Add the journal entry**

In `packages/db/src/migrations/meta/_journal.json`, append to the `entries` array, after the existing `idx: 122` entry:

```json
    {
      "idx": 123,
      "version": "7",
      "when": 1785100000000,
      "tag": "0123_combo04_token_budget_amounts",
      "breakpoints": true
    }
```

Match the surrounding indentation exactly. Hand-edit — do not regenerate.

- [ ] **Step 3: Update the drizzle schema**

In `packages/db/src/schema/budget_policies.ts`, add `bigint` to the import on line 15:

```ts
import { bigint, boolean, index, integer, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
```

and change the `amount` column:

```ts
    amount: bigint("amount", { mode: "number" }).notNull().default(0),
```

`warnPercent` stays `integer` — it is a percentage, not an amount.

In `packages/db/src/schema/budget_incidents.ts`, add `bigint` to the same import and change both columns:

```ts
    amountLimit: bigint("amount_limit", { mode: "number" }).notNull(),
    amountObserved: bigint("amount_observed", { mode: "number" }).notNull(),
```

- [ ] **Step 4: Verify the migration and typecheck**

Run: `pnpm --filter @paperclipai/db check:migrations`
Expected: PASS — the journal and the migration files agree.

Run: `pnpm typecheck`
Expected: PASS. `mode: "number"` keeps the TS type as `number`, so no consumer changes.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/0123_combo04_token_budget_amounts.sql \
        packages/db/src/migrations/meta/_journal.json \
        packages/db/src/schema/budget_policies.ts \
        packages/db/src/schema/budget_incidents.ts
git commit -m "feat(db): widen budget amount columns to bigint

A token-denominated budget can exceed the int4 ceiling of 2,147,483,647 on a
real fleet, where it would fail as a Postgres integer-out-of-range error at
insert. Converges on agent_runtime_state, which already stores token totals as
bigint({mode:\"number\"}). Widening int4 to int8 is lossless, so no USING clause
and no backfill."
```

---

### Task 2: Make observed-amount computation metric-generic

`computeObservedAmount` currently returns `0` for any metric other than `billed_cents`, so a token policy always observes zero spend and never fires. `evaluateCostEvent` separately skips those policies entirely.

Note the DB column is `text`, so a policy row with `metric = 'total_tokens'` can be inserted and exercised **before** the TS enum widens in Task 4. That is deliberate: it keeps this task independently testable and leaves the product coherent at every commit.

**Files:**
- Modify: `server/src/services/budgets.ts:157-179` (`computeObservedAmount`), `:682` (`evaluateCostEvent`)
- Create: `server/src/services/budgets.token-metric.test.ts`

**Interfaces:**
- Consumes: `budgetPolicies.amount` as `bigint`-backed `number` (Task 1).
- Produces: `computeObservedAmount(db, policy)` now returns a real sum for `metric === "total_tokens"`, and `0` for any unrecognised metric. Signature unchanged: `(db: Db, policy: Pick<PolicyRow, "companyId" | "scopeType" | "scopeId" | "windowKind" | "metric">) => Promise<number>`.

- [ ] **Step 1: Write the failing test**

Create `server/src/services/budgets.token-metric.test.ts`:

```ts
/**
 * FILE: server/src/services/budgets.token-metric.test.ts
 * ABOUT: budgets.token-metric.test.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - budgets.token-metric.test.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: budgets.token-metric.test.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/budgets.token-metric.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, budgetPolicies, companies, costEvents, createDb } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { budgetService, computeObservedAmount } from "./budgets.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping token-metric budget tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`);
}

describeEmbeddedPostgres("budget token metric", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;
  let agentId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("budgets-token-metric");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);

    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Token Metric Co",
      issuePrefix: "TKM",
    });

    agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Token Agent",
    });

    // Two events so the assertion cannot pass by reading a single row.
    await db.insert(costEvents).values([
      {
        companyId,
        agentId,
        provider: "anthropic",
        biller: "anthropic",
        billingType: "subscription_included",
        model: "claude-opus-5",
        inputTokens: 1_000,
        cachedInputTokens: 4_000,
        outputTokens: 500,
        costCents: 0,
        occurredAt: new Date(),
      },
      {
        companyId,
        agentId,
        provider: "anthropic",
        biller: "anthropic",
        billingType: "subscription_included",
        model: "claude-opus-5",
        inputTokens: 2_000,
        cachedInputTokens: 0,
        outputTokens: 100,
        costCents: 0,
        occurredAt: new Date(),
      },
    ]);
  }, 20_000);

  afterAll(async () => {
    await stopDb?.();
  });

  it("sums input, cached and output tokens for a total_tokens policy", async () => {
    const observed = await computeObservedAmount(db, {
      companyId,
      scopeType: "company",
      scopeId: companyId,
      windowKind: "calendar_month_utc",
      metric: "total_tokens",
    });

    // (1000 + 4000 + 500) + (2000 + 0 + 100)
    expect(observed).toBe(7_600);
  });

  it("still sums cents for a billed_cents policy, ignoring tokens", async () => {
    const observed = await computeObservedAmount(db, {
      companyId,
      scopeType: "company",
      scopeId: companyId,
      windowKind: "calendar_month_utc",
      metric: "billed_cents",
    });

    expect(observed).toBe(0);
  });

  it("returns 0 for an unrecognised metric rather than throwing", async () => {
    const observed = await computeObservedAmount(db, {
      companyId,
      scopeType: "company",
      scopeId: companyId,
      windowKind: "calendar_month_utc",
      metric: "not_a_real_metric",
    });

    expect(observed).toBe(0);
  });

  it("round-trips a budget amount above the old int4 ceiling", async () => {
    const hugeAmount = 5_000_000_000;
    const policyId = randomUUID();
    await db.insert(budgetPolicies).values({
      id: policyId,
      companyId,
      scopeType: "agent",
      scopeId: agentId,
      metric: "total_tokens",
      windowKind: "calendar_month_utc",
      amount: hugeAmount,
    });

    const [row] = await db.select().from(budgetPolicies).where(eq(budgetPolicies.id, policyId));
    expect(row?.amount).toBe(hugeAmount);
  });
});
// [END: module]
```

`agents` requires only `id`, `companyId` and `name`; `cost_events` requires `companyId`, `agentId`, `provider`, `model`, `costCents` and `occurredAt`. Both seeds above satisfy that.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm exec vitest run src/services/budgets.token-metric.test.ts`
Expected: FAIL. The first test fails with `expected 0 to be 7600` (the short-circuit returns `0`), and the file may also fail to compile because `computeObservedAmount` is not yet exported — it already is (`budgets.ts:157`), so expect the assertion failure.

- [ ] **Step 3: Make the observed-amount expression metric-generic**

In `server/src/services/budgets.ts`, add this helper immediately above `computeObservedAmount`:

```ts
/**
 * SQL sum expression for a budget metric, or null when the metric is unrecognised.
 *
 * `total_tokens` counts cached input tokens at full weight: the metric models the
 * subscription / rate-limit constraint, and providers count cache reads against
 * usage windows. This is neutral on caching rather than punitive — caching shows
 * up as lower `billed_cents` and in the cache-hit rate, not as budget headroom.
 */
function observedAmountExpression(metric: string) {
  if (metric === "billed_cents") {
    return sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`;
  }
  if (metric === "total_tokens") {
    return sql<number>`coalesce(sum(${costEvents.inputTokens} + ${costEvents.cachedInputTokens} + ${costEvents.outputTokens}), 0)::double precision`;
  }
  return null;
}
```

Then replace the body of `computeObservedAmount`. The current first line is:

```ts
  if (policy.metric !== "billed_cents") return 0;
```

Replace it with:

```ts
  // An unrecognised metric can only reach here from a hand-written row or a rolled-back
  // deploy. Return 0 rather than throwing: enforcement is real, but a budget the engine
  // cannot compute must never halt the fleet. The failure direction is "do not block".
  const totalExpression = observedAmountExpression(policy.metric);
  if (!totalExpression) return 0;
```

and change the select to use it:

```ts
  const [row] = await db
    .select({ total: totalExpression })
    .from(costEvents)
    .where(and(...conditions));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm exec vitest run src/services/budgets.token-metric.test.ts`
Expected: PASS — all four tests.

- [ ] **Step 5: Stop skipping token policies on cost events**

In `server/src/services/budgets.ts:682`, change:

```ts
        if (policy.metric !== "billed_cents" || policy.amount <= 0) continue;
```

to:

```ts
        if (policy.amount <= 0) continue;
```

- [ ] **Step 6: Run the full budget suites**

Run: `cd server && pnpm exec vitest run src/__tests__/budgets-service.test.ts src/services/budgets.token-metric.test.ts`
Expected: PASS, including every pre-existing dollar-budget test unchanged. `budgets-service.test.ts` is the stub-based suite — it is not modified by this task, only used as the regression check that dispatch behaviour for dollar policies is untouched.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/budgets.ts \
        server/src/services/budgets.token-metric.test.ts
git commit -m "feat(budgets): compute observed amount per metric, not just cents

Replaces the metric !== billed_cents short-circuit with a metric-to-sum-expression
map, and stops evaluateCostEvent skipping non-dollar policies. total_tokens sums
input + cached + output: the metric models the subscription/rate-limit constraint,
and providers count cache reads against usage windows, so counting them is neutral
on caching rather than punitive.

An unrecognised metric returns 0 rather than throwing. Enforcement is real, but a
budget the engine cannot compute must never halt the fleet."
```

---

### Task 3: Evaluate every active policy per scope, not just the dollar one

`getInvocationBlock` fetches **one** policy per scope with `eq(metric, "billed_cents")` and `rows[0]`. The query shape itself — not just the filter — assumes a single policy per scope, so even a working token policy could never block a run. This is what makes 019 §6's mixed enforcement real: hardest-binding wins.

**Files:**
- Modify: `server/src/services/budgets.ts:775-865` (three lookups inside `getInvocationBlock`)
- Modify: `server/src/services/budgets.token-metric.test.ts`

**Interfaces:**
- Consumes: `computeObservedAmount` from Task 2.
- Produces: a helper declared **inside** `budgetService(db)`, closing over `db` like the other private helpers in that factory:

```ts
async function findBlockingPolicy(
  scopeType: BudgetScopeType,
  scopeId: string,
  companyId: string,
): Promise<{ policy: PolicyRow; observed: number } | null>
```

  returning the first active policy at that scope whose hard stop is breached, or `null`. Also a module-level `metricNoun(metric: string): string`.

- [ ] **Step 1: Write the failing test**

Append to `server/src/services/budgets.token-metric.test.ts`, inside the existing `describeEmbeddedPostgres` block. `budgetService` is already imported by that file from Task 2:

```ts
  it("blocks invocation on a breached token policy while the dollar policy is fine", async () => {
    const blockCompanyId = randomUUID();
    await db.insert(companies).values({
      id: blockCompanyId,
      name: "Mixed Metric Co",
      issuePrefix: "MIX",
    });
    const blockAgentId = randomUUID();
    await db.insert(agents).values({
      id: blockAgentId,
      companyId: blockCompanyId,
      name: "Mixed Agent",
    });

    await db.insert(costEvents).values({
      companyId: blockCompanyId,
      agentId: blockAgentId,
      provider: "anthropic",
      biller: "anthropic",
      billingType: "subscription_included",
      model: "claude-opus-5",
      inputTokens: 6_000,
      cachedInputTokens: 3_000,
      outputTokens: 1_000,
      costCents: 5,
      occurredAt: new Date(),
    });

    // Dollars: 5 cents observed against a 10_000 cent cap — nowhere near.
    await db.insert(budgetPolicies).values({
      companyId: blockCompanyId,
      scopeType: "agent",
      scopeId: blockAgentId,
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      amount: 10_000,
      hardStopEnabled: true,
    });
    // Tokens: 10_000 observed against a 5_000 cap — breached.
    await db.insert(budgetPolicies).values({
      companyId: blockCompanyId,
      scopeType: "agent",
      scopeId: blockAgentId,
      metric: "total_tokens",
      windowKind: "calendar_month_utc",
      amount: 5_000,
      hardStopEnabled: true,
    });

    const service = budgetService(db);
    const block = await service.getInvocationBlock(blockCompanyId, blockAgentId);

    expect(block).not.toBeNull();
    expect(block?.scopeType).toBe("agent");
    expect(block?.reason).toContain("token");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm exec vitest run src/services/budgets.token-metric.test.ts -t "blocks invocation on a breached token policy"`
Expected: FAIL with `expected null not to be null` — the agent lookup filters to `billed_cents`, which is not breached, so nothing blocks.

- [ ] **Step 3: Add the helper**

In `server/src/services/budgets.ts`, add above the `return {` that opens the service object:

```ts
  /**
   * The first active policy at this scope whose hard stop is breached, or null.
   *
   * A scope may carry one policy per metric (the unique index is per
   * company/scope/metric/window), so this evaluates all of them: the
   * hardest-binding policy wins. Replaces three single-policy lookups whose
   * `rows[0]` shape assumed one policy per scope.
   */
  async function findBlockingPolicy(scopeType: BudgetScopeType, scopeId: string, companyId: string) {
    const policies = await db
      .select()
      .from(budgetPolicies)
      .where(
        and(
          eq(budgetPolicies.companyId, companyId),
          eq(budgetPolicies.scopeType, scopeType),
          eq(budgetPolicies.scopeId, scopeId),
          eq(budgetPolicies.isActive, true),
        ),
      );

    for (const policy of policies) {
      if (!policy.hardStopEnabled || policy.amount <= 0) continue;
      const observed = await computeObservedAmount(db, policy);
      if (observed >= policy.amount) return { policy, observed };
    }
    return null;
  }
```

- [ ] **Step 4: Replace the three lookups**

In `getInvocationBlock`, replace the company block (currently the `companyPolicy` select plus its `if`):

```ts
      const companyBlock = await findBlockingPolicy("company", companyId, companyId);
      if (companyBlock) {
        return {
          scopeType: "company" as const,
          scopeId: companyId,
          scopeName: company.name,
          reason: `Company cannot start new work because its ${metricNoun(companyBlock.policy.metric)} hard-stop is exceeded.`,
        };
      }
```

the agent block:

```ts
      const agentBlock = await findBlockingPolicy("agent", agentId, companyId);
      if (agentBlock) {
        return {
          scopeType: "agent" as const,
          scopeId: agentId,
          scopeName: agent.name,
          reason: `Agent cannot start because its ${metricNoun(agentBlock.policy.metric)} hard-stop is still exceeded.`,
        };
      }
```

and the project block:

```ts
      const projectBlock = await findBlockingPolicy("project", project.id, companyId);
      if (projectBlock) {
        return {
          scopeType: "project" as const,
          scopeId: project.id,
          scopeName: project.name,
          reason: `Project cannot start work because its ${metricNoun(projectBlock.policy.metric)} hard-stop is still exceeded.`,
        };
      }
```

Leave the surrounding `company.status === "paused"`, `agent.status === "paused"` and `project.pausedAt` checks exactly as they are — they are about pause state, not policy evaluation.

Add the noun helper near `observedAmountExpression`:

```ts
/** Human noun for a metric, used in operator-facing block reasons. */
function metricNoun(metric: string) {
  return metric === "total_tokens" ? "token budget" : "budget";
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && pnpm exec vitest run src/services/budgets.token-metric.test.ts src/__tests__/budgets-service.test.ts`
Expected: PASS. The dollar-budget block tests in `budgets-service.test.ts` must pass unchanged — their reason strings still read "budget hard-stop", since `metricNoun("billed_cents")` returns `"budget"`.

- [ ] **Step 6: Run the wider budget-touching suites**

Run: `cd server && pnpm exec vitest run src/__tests__/predictive-breaker.integration.test.ts src/__tests__/heartbeat-retry-scheduling.test.ts`
Expected: PASS — these seed `budget_policies` and exercise the dollar path.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/budgets.ts server/src/services/budgets.token-metric.test.ts
git commit -m "feat(budgets): evaluate every active policy per scope, hardest binding wins

getInvocationBlock fetched one policy per scope via rows[0] filtered to
billed_cents, so the query shape itself assumed a single policy per scope and a
token policy could never block a run. Collapses the three lookups into one
findBlockingPolicy helper that evaluates all active policies at the scope and
returns the first hard-stop breach. Block reasons now name the breaching metric.

heartbeat.ts and projects.ts keep their billed_cents filters deliberately: the
predictive breaker and the project spend bar are about remaining cents
specifically."
```

---

### Task 4: Add total_tokens to the metric enum and the descriptor table

With the server able to compute and enforce it, the metric can be exposed. `Record<BudgetMetric, BudgetMetricMeta>` makes adding a future metric without its descriptor a compile error.

**Files:**
- Modify: `packages/shared/src/constants.ts:626-627`
- Modify: `packages/shared/src/validators/budget.ts:28`
- Modify: `packages/shared/src/index.ts:147` region and `:272` region
- Create: `packages/shared/src/budget-metrics.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type BudgetMetric = "billed_cents" | "total_tokens";

export interface BudgetMetricMeta {
  unit: "cents" | "tokens";
  label: string;
  inputLabel: string;
  inputPlaceholder: string;
  inputScale: number;
  raiseIncrement: number;
  invalidInputMessage: string;
}

export const BUDGET_METRIC_META: Record<BudgetMetric, BudgetMetricMeta>;
```

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/budget-metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BUDGET_METRICS, BUDGET_METRIC_META } from "./constants.js";

describe("BUDGET_METRIC_META", () => {
  it("covers every budget metric", () => {
    for (const metric of BUDGET_METRICS) {
      expect(BUDGET_METRIC_META[metric]).toBeDefined();
    }
    expect(Object.keys(BUDGET_METRIC_META).sort()).toEqual([...BUDGET_METRICS].sort());
  });

  it("scales cents by 100 because the operator types dollars", () => {
    expect(BUDGET_METRIC_META.billed_cents.inputScale).toBe(100);
    expect(BUDGET_METRIC_META.billed_cents.unit).toBe("cents");
  });

  it("scales tokens by 1 because the operator types tokens", () => {
    expect(BUDGET_METRIC_META.total_tokens.inputScale).toBe(1);
    expect(BUDGET_METRIC_META.total_tokens.unit).toBe("tokens");
  });

  it("gives every metric a positive raise increment", () => {
    for (const metric of BUDGET_METRICS) {
      expect(BUDGET_METRIC_META[metric].raiseIncrement).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/shared && pnpm exec vitest run src/budget-metrics.test.ts`
Expected: FAIL — `BUDGET_METRIC_META` is not exported from `constants.js`.

- [ ] **Step 3: Widen the enum and add the descriptor**

In `packages/shared/src/constants.ts`, replace lines 626–627:

```ts
export const BUDGET_METRICS = ["billed_cents", "total_tokens"] as const;
export type BudgetMetric = (typeof BUDGET_METRICS)[number];

export interface BudgetMetricMeta {
  /** unit the stored amount is denominated in */
  unit: "cents" | "tokens";
  /** short noun for the metric in headings and payload fields */
  label: string;
  /** label above the amount input */
  inputLabel: string;
  /** placeholder for the amount input */
  inputPlaceholder: string;
  /** stored units per unit the operator types: 100 for cents (they type dollars), 1 for tokens */
  inputScale: number;
  /** default bump offered when raising a budget to resolve a hard-stop incident */
  raiseIncrement: number;
  /** validation message when the typed amount does not parse */
  invalidInputMessage: string;
}

/**
 * Presentation metadata per budget metric. Typed as a total Record so adding a
 * metric to BUDGET_METRICS without a descriptor is a compile error rather than a
 * runtime surprise. The metric-to-SQL mapping deliberately lives server-side in
 * budgets.ts: this package has no dependency on @paperclipai/db and must not gain one.
 */
export const BUDGET_METRIC_META: Record<BudgetMetric, BudgetMetricMeta> = {
  billed_cents: {
    unit: "cents",
    label: "Spend",
    inputLabel: "Budget (USD)",
    inputPlaceholder: "0.00",
    inputScale: 100,
    raiseIncrement: 1_000,
    invalidInputMessage: "Enter a valid non-negative dollar amount.",
  },
  total_tokens: {
    unit: "tokens",
    label: "Tokens",
    inputLabel: "Budget (tokens)",
    inputPlaceholder: "0",
    inputScale: 1,
    raiseIncrement: 1_000_000,
    invalidInputMessage: "Enter a valid non-negative token count.",
  },
};
```

- [ ] **Step 4: Bound the amount in the validator**

In `packages/shared/src/validators/budget.ts:28`, change:

```ts
  amount: z.number().int().nonnegative(),
```

to:

```ts
  // Upper bound at MAX_SAFE_INTEGER: the columns are bigint but drizzle reads them
  // with mode:"number", so values beyond 2^53 would lose precision silently.
  amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
```

Apply the same `.max(Number.MAX_SAFE_INTEGER)` to the optional `amount` in `resolveBudgetIncidentSchema` on line 39.

- [ ] **Step 5: Export from the top-level barrel**

In `packages/shared/src/index.ts`, add `BUDGET_METRIC_META` to the value-export list next to `BUDGET_METRICS` (around line 147), and `type BudgetMetricMeta` to the type-export list next to `type BudgetMetric` (around line 272). Both are needed — a symbol exported from only `constants.ts` resolves to `undefined` when imported from `@paperclipai/shared`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/shared && pnpm exec vitest run src/budget-metrics.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS. Widening the enum makes `BudgetMetric` a two-member union; anywhere that exhaustively switches on it will now fail to compile if it does not handle `total_tokens` — fix any such site by delegating to `BUDGET_METRIC_META`.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/constants.ts \
        packages/shared/src/validators/budget.ts \
        packages/shared/src/index.ts \
        packages/shared/src/budget-metrics.test.ts
git commit -m "feat(shared): add total_tokens metric and BUDGET_METRIC_META

Widens BUDGET_METRICS from a single-element union and adds a total Record of
presentation metadata per metric, so the UI stops hardcoding dollar formatting and
adding a metric without its descriptor is a compile error.

Bounds budget amount at MAX_SAFE_INTEGER: the columns are now bigint but drizzle
reads them with mode:\"number\", so larger values would lose precision silently."
```

---

### Task 5: Make the budget UI metric-aware

Three components hardcode `formatCents`. `BudgetIncidentCard` additionally defaults its raise suggestion to `observed + 1000` (i.e. +$10) and parses input as dollars, both meaningless in tokens. `Costs.tsx` omits `metric` on upsert, which would silently create a dollar policy when editing a token one.

**Files:**
- Modify: `ui/src/lib/utils.ts` (after `formatTokens`, ~line 112)
- Modify: `ui/src/components/BudgetPolicyCard.tsx:18,23-33,58-65,74,82,93,101,114,146-155,199,228`
- Modify: `ui/src/components/BudgetIncidentCard.tsx:53-56,74,96-99,105,114`
- Modify: `ui/src/components/ApprovalPayload.tsx:16,152,155`
- Modify: `ui/src/pages/Costs.tsx:949-954`
- Create: `ui/src/components/BudgetPolicyCard.test.tsx`

**Interfaces:**
- Consumes: `BUDGET_METRIC_META`, `type BudgetMetric` from `@paperclipai/shared` (Task 4).
- Produces: `formatBudgetAmount(metric: BudgetMetric, amount: number): string` in `ui/src/lib/utils.ts`.

- [ ] **Step 1: Write the failing test**

Create `ui/src/components/BudgetPolicyCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BudgetPolicySummary } from "@paperclipai/shared";
import { BudgetPolicyCard } from "./BudgetPolicyCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeSummary(overrides: Partial<BudgetPolicySummary>): BudgetPolicySummary {
  return {
    policyId: "policy-1",
    companyId: "company-1",
    scopeType: "agent",
    scopeId: "agent-1",
    scopeName: "Token Agent",
    metric: "billed_cents",
    windowKind: "calendar_month_utc",
    amount: 10_000,
    observedAmount: 2_500,
    remainingAmount: 7_500,
    utilizationPercent: 25,
    warnPercent: 80,
    hardStopEnabled: true,
    notifyEnabled: true,
    isActive: true,
    status: "ok",
    paused: false,
    pauseReason: null,
    windowStart: new Date(),
    windowEnd: new Date(),
    ...overrides,
  } as BudgetPolicySummary;
}

describe("BudgetPolicyCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("formats a dollar budget as currency", () => {
    act(() => {
      root.render(
        <BudgetPolicyCard summary={makeSummary({ metric: "billed_cents" })} onSave={() => {}} />,
      );
    });
    expect(container.textContent).toContain("$100.00");
    expect(container.textContent).toContain("Budget (USD)");
  });

  it("formats a token budget as tokens, not dollars", () => {
    act(() => {
      root.render(
        <BudgetPolicyCard
          summary={makeSummary({
            metric: "total_tokens",
            amount: 5_000_000,
            observedAmount: 1_250_000,
            remainingAmount: 3_750_000,
          })}
          onSave={() => {}}
        />,
      );
    });
    expect(container.textContent).toContain("5.0M");
    expect(container.textContent).toContain("1.3M");
    expect(container.textContent).not.toContain("$");
    expect(container.textContent).toContain("Budget (tokens)");
  });
});
```

Both cases pass `onSave` because the input label and placeholder only render inside `saveSection`, which is `null` when `onSave` is absent.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ui && pnpm exec vitest run src/components/BudgetPolicyCard.test.tsx`
Expected: FAIL — the token case renders `$50,000.00` (cents formatting of 5 000 000) instead of `5.0M`.

- [ ] **Step 3: Add the formatter**

In `ui/src/lib/utils.ts`, after `formatTokens`:

```ts
/**
 * Format a budget amount in its metric's own unit. Budget amounts are stored in
 * the metric's base unit — cents for billed_cents, raw tokens for total_tokens —
 * so the formatter is chosen by the metric's descriptor, not by the call site.
 */
export function formatBudgetAmount(metric: BudgetMetric, amount: number): string {
  return BUDGET_METRIC_META[metric].unit === "tokens" ? formatTokens(amount) : formatCents(amount);
}
```

and add the import at the top of the file:

```ts
import { BUDGET_METRIC_META, type BudgetMetric } from "@paperclipai/shared";
```

- [ ] **Step 4: Generalise BudgetPolicyCard**

In `ui/src/components/BudgetPolicyCard.tsx`, change the import on line 18:

```ts
import { cn, formatBudgetAmount } from "../lib/utils";
import { BUDGET_METRIC_META } from "@paperclipai/shared";
```

Replace the two helpers on lines 23–33:

```ts
function amountInputValue(value: number, inputScale: number) {
  return inputScale === 100 ? (value / 100).toFixed(2) : String(value);
}

function parseAmountInput(value: string, inputScale: number) {
  const normalized = value.trim();
  if (normalized.length === 0) return 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * inputScale);
}
```

Inside the component, replace lines 58–65 with:

```ts
  const meta = BUDGET_METRIC_META[summary.metric];
  const [draftBudget, setDraftBudget] = useState(amountInputValue(summary.amount, meta.inputScale));

  useEffect(() => {
    setDraftBudget(amountInputValue(summary.amount, meta.inputScale));
  }, [summary.amount, meta.inputScale]);

  const parsedDraft = parseAmountInput(draftBudget, meta.inputScale);
  const canSave = typeof parsedDraft === "number" && parsedDraft !== summary.amount && Boolean(onSave);
```

Replace each of the five `formatCents(...)` calls (lines 74, 82, 93, 101, 114) with `formatBudgetAmount(summary.metric, ...)` on the same argument. For example line 74 becomes:

```tsx
        <div className="mt-2 text-xl font-semibold tabular-nums">{formatBudgetAmount(summary.metric, summary.observedAmount)}</div>
```

Replace the input label and placeholder (lines 146–155):

```tsx
        <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {meta.inputLabel}
        </label>
        <Input
          value={draftBudget}
          onChange={(event) => setDraftBudget(event.target.value)}
          className="mt-2"
          inputMode={meta.unit === "tokens" ? "numeric" : "decimal"}
          placeholder={meta.inputPlaceholder}
        />
```

Replace both validation messages (lines 199 and 228):

```tsx
          <p className="text-xs text-destructive">{meta.invalidInputMessage}</p>
```

Rename the `onSave` prop type on line 53 from `(amountCents: number) => void` to `(amount: number) => void` — it is no longer cents-specific.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd ui && pnpm exec vitest run src/components/BudgetPolicyCard.test.tsx`
Expected: PASS — both cases.

- [ ] **Step 6: Generalise BudgetIncidentCard**

In `ui/src/components/BudgetIncidentCard.tsx`, import the descriptor and formatter the same way, apply the same `amountInputValue` / `parseAmountInput` helpers, and change the raise default (lines 53–56):

```ts
  const meta = BUDGET_METRIC_META[incident.metric];
  const [draftAmount, setDraftAmount] = useState(
    amountInputValue(
      Math.max(incident.amountObserved + meta.raiseIncrement, incident.amountLimit),
      meta.inputScale,
    ),
  );
  const parsed = parseAmountInput(draftAmount, meta.inputScale);
```

Change the description on line 74:

```tsx
              Usage reached {formatBudgetAmount(incident.metric, incident.amountObserved)} against a limit of {formatBudgetAmount(incident.metric, incident.amountLimit)}.
```

("Spending reached" becomes "Usage reached" — it is no longer necessarily spending.)

Change the input label and placeholder (lines 96–99) to `{meta.inputLabel.replace("Budget", "New budget")}` and `meta.inputPlaceholder`, with `inputMode={meta.unit === "tokens" ? "numeric" : "decimal"}`. Rename the `onRaiseAndResume` param type from `amountCents` to `amount`.

- [ ] **Step 7: Generalise ApprovalPayload**

In `ui/src/components/ApprovalPayload.tsx`, inside `BudgetOverridePayload`, resolve the metric from the payload and format with it:

```tsx
  const metric = typeof payload.metric === "string" && payload.metric in BUDGET_METRIC_META
    ? (payload.metric as BudgetMetric)
    : "billed_cents";
  const meta = BUDGET_METRIC_META[metric];
```

Change line 152 to show the label rather than the raw slug:

```tsx
      <PayloadField label="Metric" value={meta.label} />
```

and line 155:

```tsx
          Limit {budgetAmount !== null ? formatBudgetAmount(metric, budgetAmount) : "—"} · Observed {observedAmount !== null ? formatBudgetAmount(metric, observedAmount) : "—"}
```

The `in BUDGET_METRIC_META` guard matters: approval payloads are stored JSON and may predate any metric change, so an unrecognised value must fall back rather than crash the card.

- [ ] **Step 8: Fix the Costs upsert to carry the metric**

In `ui/src/pages/Costs.tsx:949`, add `metric` to the mutation payload:

```tsx
                            onSave={(amount) =>
                              policyMutation.mutate({
                                scopeType: summary.scopeType,
                                scopeId: summary.scopeId,
                                metric: summary.metric,
                                amount,
                                windowKind: summary.windowKind,
                              })}
```

Without this the validator defaults `metric` to `billed_cents`, so editing a token policy's amount would upsert a *dollar* policy at the same scope — creating a second policy rather than editing the one on screen.

- [ ] **Step 9: Run the UI suites and typecheck**

Run: `cd ui && pnpm exec vitest run src/components/BudgetPolicyCard.test.tsx src/pages/ProjectDetail.test.tsx`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add ui/src/lib/utils.ts \
        ui/src/components/BudgetPolicyCard.tsx \
        ui/src/components/BudgetPolicyCard.test.tsx \
        ui/src/components/BudgetIncidentCard.tsx \
        ui/src/components/ApprovalPayload.tsx \
        ui/src/pages/Costs.tsx
git commit -m "feat(ui): render budget amounts in their metric's own unit

BudgetPolicyCard, BudgetIncidentCard and ApprovalPayload hardcoded formatCents.
They now read BUDGET_METRIC_META for formatting, input scale, labels and copy, so
a token budget renders as tokens and its input is parsed as a raw count rather
than dollars. The incident raise default uses the metric's raiseIncrement instead
of a hardcoded +\$10.

Also fixes a latent bug: Costs.tsx upserted without metric, which the validator
defaults to billed_cents. Harmless with one metric; with two it would create a
dollar policy at the scope instead of editing the token policy on screen."
```

---

### Task 6: Let operators create a token budget

There is currently no UI path to create a non-dollar policy. `AgentDetail` and `ProjectDetail` match an existing policy by scope alone and fall back to a synthetic `billed_cents` summary, and their mutations omit `metric`. The Costs tab's own empty state points operators to these pages ("Set agent and project budgets from their detail pages"), so this is where the toggle belongs.

**Files:**
- Modify: `ui/src/pages/AgentDetail.tsx:739-772` (summary memo), `:834-841` (mutation), `:1188-1195` (render)
- Modify: `ui/src/pages/ProjectDetail.tsx:619-645` (summary memo), `:648-655` (mutation), `:911` (render)

**Interfaces:**
- Consumes: `BUDGET_METRIC_META`, `type BudgetMetric` (Task 4); the metric-aware `BudgetPolicyCard` (Task 5).
- Produces: no exported symbols — page-local state only.

- [ ] **Step 1: Add metric state to AgentDetail**

Near the other `useState` declarations in `AgentDetail`, add:

```tsx
  const [budgetMetric, setBudgetMetric] = useState<BudgetMetric>("billed_cents");
```

with `import { BUDGET_METRIC_META, type BudgetMetric } from "@paperclipai/shared";` added to the imports.

- [ ] **Step 2: Make the summary memo metric-aware**

In the `agentBudgetSummary` memo, change the match to require the metric, and the synthetic fallback to use the selected metric. Replace lines 740–742:

```tsx
    const matched = budgetOverview?.policies.find(
      (policy) =>
        policy.scopeType === "agent" &&
        policy.scopeId === (agent?.id ?? routeAgentRef) &&
        policy.metric === budgetMetric,
    );
```

Replace line 752 (`metric: "billed_cents",`) with `metric: budgetMetric,`.

The legacy `agent.budgetMonthlyCents` / `spentMonthlyCents` fallback values are cents, so they must only be used for the dollar metric. Replace lines 744–745:

```tsx
    const budgetMonthlyCents = budgetMetric === "billed_cents" ? (agent?.budgetMonthlyCents ?? 0) : 0;
    const spentMonthlyCents = budgetMetric === "billed_cents" ? (agent?.spentMonthlyCents ?? 0) : 0;
```

Add `budgetMetric` to the memo's dependency array.

- [ ] **Step 3: Send the metric on save**

In the `budgetMutation` (line 836), add `metric: budgetMetric,` to the `upsertPolicy` payload, after `scopeId`.

- [ ] **Step 4: Render the toggle**

Replace the budget view block at line 1188:

```tsx
      {activeView === "budget" && resolvedCompanyId ? (
        <div className="max-w-3xl space-y-4">
          <div className="inline-flex rounded-lg border border-border/70 p-1">
            {(Object.keys(BUDGET_METRIC_META) as BudgetMetric[]).map((metric) => (
              <button
                key={metric}
                type="button"
                onClick={() => setBudgetMetric(metric)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs uppercase tracking-[0.18em] transition-colors",
                  budgetMetric === metric
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {BUDGET_METRIC_META[metric].label}
              </button>
            ))}
          </div>
          <BudgetPolicyCard
            summary={agentBudgetSummary}
            isSaving={budgetMutation.isPending}
            onSave={(amount) => budgetMutation.mutate(amount)}
            variant="plain"
          />
        </div>
      ) : null}
```

Ensure `cn` is imported from `../lib/utils` in this file; add it if not.

- [ ] **Step 5: Apply the same change to ProjectDetail**

Repeat steps 1–4 in `ui/src/pages/ProjectDetail.tsx`: add `budgetMetric` state, add `policy.metric === budgetMetric` to the match in the summary memo at line 620, change line 630 to `metric: budgetMetric,`, add `metric: budgetMetric,` to the mutation payload at line 650, and wrap the `BudgetPolicyCard` at line 911 in the same toggle. Project policies use `windowKind: "lifetime"` — leave that unchanged for both metrics.

- [ ] **Step 6: Verify end to end**

Run: `pnpm typecheck`
Expected: PASS.

Run: `cd ui && pnpm exec vitest run src/pages/ProjectDetail.test.tsx src/components/BudgetPolicyCard.test.tsx`
Expected: PASS.

Then start the app and confirm by hand: open an agent's Budget view, switch to Tokens, set a budget, reload, and confirm the token policy persists and the dollar policy is untouched when you switch back.

- [ ] **Step 7: Commit**

```bash
git add ui/src/pages/AgentDetail.tsx ui/src/pages/ProjectDetail.tsx
git commit -m "feat(ui): let operators set a token budget from the detail pages

Adds a dollars|tokens toggle to the budget view on AgentDetail and ProjectDetail,
the places the Costs tab's empty state already points operators to. The summary
memo now matches a policy by scope AND metric, and the upsert sends the selected
metric, so the two policies at a scope are edited independently.

The legacy budgetMonthlyCents/spentMonthlyCents fallback is cents-denominated and
is now only used for the dollar metric."
```

---

### Task 7: Cache-hit rate function (idea 037)

Independent of tasks 1–6. The data is already collected; only the derived rate is missing.

**Files:**
- Create: `packages/shared/src/cache-metrics.ts`
- Create: `packages/shared/src/cache-metrics.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type CacheHitBand = "insufficient_data" | "low" | "moderate" | "good";
export interface CacheHitRateResult {
  rate: number | null;
  band: CacheHitBand;
  totalInputTokens: number;
}
export const CACHE_HIT_RATE_VOLUME_FLOOR: 10_000;
export const CACHE_HIT_RATE_BANDS: { low: 0.4; moderate: 0.7 };
export function computeCacheHitRate(cachedInputTokens: number, inputTokens: number): CacheHitRateResult;
```

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/cache-metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CACHE_HIT_RATE_VOLUME_FLOOR, computeCacheHitRate } from "./cache-metrics.js";

describe("computeCacheHitRate", () => {
  it("reports insufficient data below the volume floor", () => {
    const result = computeCacheHitRate(900, 100);
    expect(result.rate).toBeNull();
    expect(result.band).toBe("insufficient_data");
    expect(result.totalInputTokens).toBe(1_000);
  });

  it("reports insufficient data when there is no input at all", () => {
    const result = computeCacheHitRate(0, 0);
    expect(result.rate).toBeNull();
    expect(result.band).toBe("insufficient_data");
  });

  it("divides cached by total input, not by fresh input", () => {
    const result = computeCacheHitRate(30_000, 70_000);
    expect(result.rate).toBeCloseTo(0.3, 5);
    expect(result.totalInputTokens).toBe(100_000);
  });

  it("bands idea 037's worked example of 31% as low", () => {
    expect(computeCacheHitRate(31_000, 69_000).band).toBe("low");
  });

  it("bands a mid rate as moderate and a high rate as good", () => {
    expect(computeCacheHitRate(50_000, 50_000).band).toBe("moderate");
    expect(computeCacheHitRate(80_000, 20_000).band).toBe("good");
  });

  it("treats the band thresholds as lower-inclusive", () => {
    expect(computeCacheHitRate(40_000, 60_000).band).toBe("moderate");
    expect(computeCacheHitRate(70_000, 30_000).band).toBe("good");
  });

  it("clamps negative inputs to zero", () => {
    const result = computeCacheHitRate(-5, -5);
    expect(result.totalInputTokens).toBe(0);
    expect(result.band).toBe("insufficient_data");
  });

  it("counts a rate of exactly 1 when everything is cached", () => {
    const result = computeCacheHitRate(CACHE_HIT_RATE_VOLUME_FLOOR, 0);
    expect(result.rate).toBe(1);
    expect(result.band).toBe("good");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/shared && pnpm exec vitest run src/cache-metrics.test.ts`
Expected: FAIL — `Cannot find module './cache-metrics.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/cache-metrics.ts`:

```ts
/**
 * FILE: packages/shared/src/cache-metrics.ts
 * ABOUT: cache-metrics.ts (shared module).
 *
 * SECTIONS:
 *   [TAG: module] - cache-metrics.ts (shared module).
 */
// ==========================================
// [META: module]
// INTENT: Derive prompt-cache efficiency from token counts already collected.
// PSEUDOCODE: 1. Clamp inputs. 2. Sum total input. 3. Band the ratio.
// JSON_FLOW: {"file": "packages/shared/src/cache-metrics.ts", "imports": "none", "exports": "computeCacheHitRate"}
// ==========================================
// [START: module]

/**
 * Minimum total input tokens before a cache-hit rate is meaningful. A 100% rate
 * off a single small run is noise, not a signal.
 */
export const CACHE_HIT_RATE_VOLUME_FLOOR = 10_000;

/**
 * Lower-inclusive band thresholds. These are a first-pass heuristic, not a measured
 * one — chosen so idea 037's own worked example (31%) reads as "low". They live here
 * so they can be retuned once there is real fleet data to calibrate against.
 */
export const CACHE_HIT_RATE_BANDS = { low: 0.4, moderate: 0.7 } as const;

export type CacheHitBand = "insufficient_data" | "low" | "moderate" | "good";

export interface CacheHitRateResult {
  /** cached / (cached + fresh input), or null below the volume floor */
  rate: number | null;
  band: CacheHitBand;
  totalInputTokens: number;
}

/**
 * Prompt-cache hit rate over a set of cost events.
 *
 * `inputTokens` in this schema is *fresh* (uncached) input, so the denominator is
 * the sum of both columns rather than `inputTokens` alone.
 */
export function computeCacheHitRate(cachedInputTokens: number, inputTokens: number): CacheHitRateResult {
  const cached = Number.isFinite(cachedInputTokens) ? Math.max(0, cachedInputTokens) : 0;
  const fresh = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const totalInputTokens = cached + fresh;

  if (totalInputTokens < CACHE_HIT_RATE_VOLUME_FLOOR) {
    return { rate: null, band: "insufficient_data", totalInputTokens };
  }

  const rate = cached / totalInputTokens;
  const band: CacheHitBand =
    rate < CACHE_HIT_RATE_BANDS.low ? "low" : rate < CACHE_HIT_RATE_BANDS.moderate ? "moderate" : "good";

  return { rate, band, totalInputTokens };
}
// [END: module]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/shared && pnpm exec vitest run src/cache-metrics.test.ts`
Expected: PASS — all eight tests.

- [ ] **Step 5: Export from the top-level barrel**

In `packages/shared/src/index.ts`, add a new export block near the `agent-eligibility.js` block (around line 20):

```ts
export {
  CACHE_HIT_RATE_BANDS,
  CACHE_HIT_RATE_VOLUME_FLOOR,
  computeCacheHitRate,
  type CacheHitBand,
  type CacheHitRateResult,
} from "./cache-metrics.js";
```

- [ ] **Step 6: Verify the barrel export resolves**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/cache-metrics.ts \
        packages/shared/src/cache-metrics.test.ts \
        packages/shared/src/index.ts
git commit -m "feat(shared): add computeCacheHitRate (idea 037)

Derives cached / (cached + fresh input) from token counts already collected. The
denominator sums both columns because inputTokens in this schema is fresh input.

Below a 10k total-input floor the result is insufficient_data rather than a rate:
100% off one small run is noise. The low/moderate/good thresholds are an
unmeasured first-pass heuristic, exported as a constant so they can be retuned."
```

---

### Task 8: Surface cache-hit rate on the Costs page

**Files:**
- Modify: `ui/src/pages/Costs.tsx` (company total near the existing token-total reducers at ~line 532; per-agent near the row rendering at ~line 764)
- Create: `ui/src/pages/Costs.cacheHitRate.test.tsx`

**Interfaces:**
- Consumes: `computeCacheHitRate`, `type CacheHitBand` from `@paperclipai/shared` (Task 7). The rows already carry `inputTokens` and `cachedInputTokens` — no new endpoint, no new query.
- Produces: no exported symbols.

- [ ] **Step 1: Write the failing test**

Create `ui/src/pages/Costs.cacheHitRate.test.tsx` following the jsdom pattern from Task 5. Render the smallest component that shows the figure — extract the display into a named component in `Costs.tsx` so it can be tested without mounting the whole page and its query client:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CacheHitRate } from "./Costs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("CacheHitRate", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders a percentage and its band", () => {
    act(() => {
      root.render(<CacheHitRate cachedInputTokens={80_000} inputTokens={20_000} />);
    });
    expect(container.textContent).toContain("80%");
    expect(container.textContent?.toLowerCase()).toContain("good");
  });

  it("renders an honest placeholder below the volume floor", () => {
    act(() => {
      root.render(<CacheHitRate cachedInputTokens={100} inputTokens={100} />);
    });
    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toContain("%");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ui && pnpm exec vitest run src/pages/Costs.cacheHitRate.test.tsx`
Expected: FAIL — `CacheHitRate` is not exported from `./Costs`.

- [ ] **Step 3: Add the component**

In `ui/src/pages/Costs.tsx`, add near the other module-level helpers:

```tsx
const CACHE_BAND_TONE: Record<CacheHitBand, string> = {
  insufficient_data: "text-muted-foreground",
  low: "text-amber-300",
  moderate: "text-sky-300",
  good: "text-emerald-300",
};

const CACHE_BAND_LABEL: Record<CacheHitBand, string> = {
  insufficient_data: "not enough data",
  low: "low",
  moderate: "moderate",
  good: "good",
};

/**
 * Prompt-cache hit rate for a set of rows. Derived client-side: the costs API
 * already returns both token columns, so serving the ratio would duplicate state.
 */
export function CacheHitRate({
  cachedInputTokens,
  inputTokens,
}: {
  cachedInputTokens: number;
  inputTokens: number;
}) {
  const { rate, band } = computeCacheHitRate(cachedInputTokens, inputTokens);
  return (
    <span className={cn("tabular-nums", CACHE_BAND_TONE[band])}>
      {rate === null ? "—" : `${Math.round(rate * 100)}%`}
      <span className="ml-1 text-xs text-muted-foreground">{CACHE_BAND_LABEL[band]}</span>
    </span>
  );
}
```

Add to the imports:

```tsx
import { computeCacheHitRate, type CacheHitBand } from "@paperclipai/shared";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ui && pnpm exec vitest run src/pages/Costs.cacheHitRate.test.tsx`
Expected: PASS — both cases.

- [ ] **Step 5: Render it in the page**

For the **company-level** figure, add these two reducers next to the existing `totalTokens` reducer at ~line 532, which already sums all three columns over the same `rows`:

```tsx
  const totalCachedInputTokens = rows.reduce((sum, row) => sum + row.cachedInputTokens, 0);
  const totalFreshInputTokens = rows.reduce((sum, row) => sum + row.inputTokens, 0);
```

and render it as a stat beside the existing token total:

```tsx
  <div>
    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Cache hit rate</div>
    <div className="mt-2 text-xl font-semibold">
      <CacheHitRate cachedInputTokens={totalCachedInputTokens} inputTokens={totalFreshInputTokens} />
    </div>
  </div>
```

For the **per-agent** figure, extend the row at ~line 764, which currently renders `in {formatTokens(row.inputTokens + row.cachedInputTokens)} · out {formatTokens(row.outputTokens)}`, by appending:

```tsx
{" · cache "}
<CacheHitRate cachedInputTokens={row.cachedInputTokens} inputTokens={row.inputTokens} />
```

- [ ] **Step 6: Verify**

Run: `cd ui && pnpm exec vitest run src/pages/Costs.cacheHitRate.test.tsx`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/src/pages/Costs.tsx ui/src/pages/Costs.cacheHitRate.test.tsx
git commit -m "feat(ui): surface prompt-cache hit rate on the Costs page

Company-level and per-agent cache-hit rate, derived client-side from the token
columns the costs API already returns — no new endpoint and no new query. Below
the volume floor it renders an em dash rather than a misleading percentage."
```

---

## Final verification

- [ ] Run the full test suite: `pnpm test`
- [ ] Run `pnpm typecheck`. (There is **no root `lint` script** in this monorepo — an earlier draft of this plan listed one. `typecheck` and `test` are the gates.)
- [ ] Run `pnpm --filter @paperclipai/db check:migrations`
- [ ] Expect a fully green suite. (Earlier notes flagged `ui/src/components/artifacts/ArtifactCard.test.tsx` as a known date-dependent failure; it did **not** fail on 2026-08-02 — all 254 UI files passed. Do not excuse a failure there on the strength of that note.)
- [ ] Walk the spec's Exit criteria section and check each box against the running app.
- [ ] Append a `## [YYYY-MM-DD] Completed — Combo 04 Phase 1` entry to `docs/superpowers/BUILD-DECISIONS.md`, and update the status table row for Combo 04 from "Phase 1 substrate already built" to the real state.
