# Combo 04 Phase 1 — Token-Denominated Budgets + Cache-Hit Metric

**Date:** 2026-08-01
**Combo:** 04 — Autonomous CFO Suite (Economics, P&L & Forecasting)
**Phase:** 1 of 4 (ideas 019 + 037)
**Depends on:** Combo 02 Phase 1 (local inference billing truth) — merged, PR #38
**Status:** design, approved

---

## Pre-flight findings

Verified on `master` @ `e8e001c`.

| Claim | Verified |
|-------|----------|
| `budget_policies.metric` is a generic column | **Yes.** `text("metric").notNull().default("billed_cents")`, with a unique index on `(company_id, scope_type, scope_id, metric, window_kind)` — so one dollar policy *and* one token policy can already coexist per scope. |
| `BudgetMetric` type exists | **Yes**, but `BUDGET_METRICS = ["billed_cents"]` is a single-element union (`constants.ts:626`). |
| The threshold / incident / approval / pause machinery is metric-agnostic | **Yes.** `buildPolicySummary`, `budgetStatusFromObserved`, `createIncidentIfNeeded`, `buildApprovalPayload` and the resolve path all operate on `amount` vs `observedAmount` without reference to units. |
| `cost_events` carries real token data | **Yes.** `inputTokens` / `cachedInputTokens` / `outputTokens`, written from actual adapter usage (`heartbeat.ts:2135–2157`), not defaulted. |
| The blocker is one short-circuit | **No — it is five sites.** See below. |
| No migration needed | **Wrong.** The amount columns are `integer`, a ceiling of 2 147 483 647. See §2. |
| A UI path exists to create a non-dollar policy | **No.** Both detail pages match an existing policy by scope alone and fall back to a synthetic summary hardcoding `metric: "billed_cents"` (`AgentDetail.tsx:752`, `ProjectDetail.tsx:630`), and their `upsertPolicy` mutations (`AgentDetail.tsx:836`, `ProjectDetail.tsx:650`) omit `metric` entirely, so the validator defaults it to dollars. |

### The five pinned sites

1. `budgets.ts:161` — `computeObservedAmount` returns `0` for any metric that is not `billed_cents`, so a token policy always observes zero spend and never fires.
2. `budgets.ts:682` — `evaluateCostEvent` skips non-`billed_cents` policies entirely, so nothing is ever evaluated on a cost event.
3. `budgets.ts:779`, `:813`, `:854` — `getInvocationBlock` fetches **one** policy per scope (company / agent / project) with `eq(metric, "billed_cents")` and `rows[0]`, so even a working token policy could never block a run.

Two further `eq(metric, "billed_cents")` filters — `heartbeat.ts:7460` and `projects.ts:398` — are **deliberately left pinned**. The predictive breaker and the project spend bar are about *remaining cents* specifically; generalising them would be a category error, not a fix.

---

## Scope

**In:** `total_tokens` as a second budget metric, enforced with the same teeth as dollars; a derived cache-hit-rate metric; the UI work to make both reachable and legible.

**Out**, each deferred deliberately:

| Deferred | Why |
|----------|-----|
| Provider-rate-limit window alignment (019 §3) | Needs `quota-windows.ts` integration. Idea 019 itself says ship calendar windows first. |
| Imputed / shadow dollar cost (019 §5) | Belongs with idea 013 in phase 2, which is what consumes it. |
| Cache-buster diagnosis, stable-prefix assembly (037 §1, §3) | The combo doc places these in phase 4. |
| `input_tokens` / `output_tokens` / `run_count` metrics | YAGNI. The enum and the descriptor table are shaped to take them with no further surgery. |

---

## 1. The metric

```
total_tokens = inputTokens + cachedInputTokens + outputTokens
```

**Cached tokens count fully.** The metric's job is to model the subscription / rate-limit constraint, and providers do count cache reads against usage windows. This is *neutral* on caching rather than punitive — a cache-heavy agent consumes the same token budget as one that is not — and caching still shows up where it belongs: as lower dollars, and as a visible cache-hit rate. Excluding cached tokens would reward caching at the cost of systematically under-reporting what the provider window actually saw, loosening the guardrail exactly where the constraint is real.

The alternatives were considered and rejected: a second `billable_tokens` metric doubles enum, UI, copy and test surface for a phase the combo doc calls "small, high-insight"; a fractional weight for cached tokens (~0.1×) is provider-specific and would be a hardcoded constant that silently goes stale.

## 2. Data model

No new tables. **One hand-written migration**, additive and non-destructive:

```sql
ALTER TABLE budget_policies  ALTER COLUMN amount           TYPE bigint;
ALTER TABLE budget_incidents ALTER COLUMN amount_limit     TYPE bigint;
ALTER TABLE budget_incidents ALTER COLUMN amount_observed  TYPE bigint;
```

Drizzle columns move to `bigint({ mode: "number" })`, matching `agent_runtime_state`, which already stores `totalInputTokens` / `totalOutputTokens` / `totalCachedInputTokens` that way. These columns now hold the same kind of quantity, so this is convergence on an existing convention rather than a new one.

The `integer` ceiling of 2 147 483 647 is ample for cents ($21.4 M) but reachable for a monthly token budget on a real fleet, and the failure mode is a Postgres `integer out of range` error at insert — loud, but a 500 where a working budget belongs.

Written as raw SQL plus a `meta/_journal.json` entry. **Never `drizzle-kit generate`** — the snapshot baseline is stale at `0098` and generate emits a destructive bundle.

`BUDGET_METRICS` becomes `["billed_cents", "total_tokens"]`. The existing unique index gives 019 §6's mixed enforcement for free: a scope may carry one policy per metric, and the hardest-binding one wins.

## 3. Server

Four changes in `budgets.ts`, all of them removing a special case rather than adding one.

**`computeObservedAmount`** replaces the short-circuit with a metric → sum-expression map:

| Metric | Expression |
|--------|------------|
| `billed_cents` | `sum(costCents)` |
| `total_tokens` | `sum(inputTokens + cachedInputTokens + outputTokens)` |

An unrecognised metric returns `0`. This is a deliberate asymmetry: enforcement is real, but a budget the engine cannot *compute* must never halt the fleet. The failure direction is "do not block", matching how `fallback-chain.ts` treats unrecognised input as `retry_same`. It is documented with a code comment rather than a log line — `server/src/services/` has no structured logger, and an unrecognised metric can only arise from a hand-written row or a rolled-back deploy.

**`evaluateCostEvent`** drops `policy.metric !== "billed_cents"` from its skip condition, keeping the `amount <= 0` guard.

**`getInvocationBlock`**'s three single-policy lookups collapse into one helper:

```ts
findBlockingPolicy(companyId, scopeType, scopeId): Promise<PolicyRow | null>
```

which selects *all* active policies for the scope and returns the first whose hard stop is breached. The returned block reason names the breaching metric, so an operator sees "token budget" rather than a generic message. This is the change that makes mixed enforcement real: today the query shape itself, not just the filter, assumes one policy per scope.

The metric → column mapping stays server-side. `packages/shared` has no dependency on `@paperclipai/db` and must not gain one.

## 4. Shared

Two additions, both pure and testable with no database.

**`BUDGET_METRIC_META`** in `constants.ts`:

```ts
export interface BudgetMetricMeta {
  unit: "cents" | "tokens";
  label: string;
  /** stored units per unit the operator types: 100 for cents (they type dollars), 1 for tokens */
  inputScale: number;
  /** default bump offered when raising a budget to resolve a hard-stop incident */
  raiseIncrement: number;
}

export const BUDGET_METRIC_META: Record<BudgetMetric, BudgetMetricMeta> = {
  billed_cents: { unit: "cents",  label: "Spend",  inputScale: 100, raiseIncrement: 1_000 },
  total_tokens: { unit: "tokens", label: "Tokens", inputScale: 1,   raiseIncrement: 1_000_000 },
};
```

Typing it as `Record<BudgetMetric, …>` makes adding a metric without its descriptor a compile error rather than a runtime surprise.

**`computeCacheHitRate(cachedInputTokens, inputTokens)`** in a new `packages/shared/src/cache-metrics.ts`, returning `{ rate, band, totalInputTokens }`.

- Denominator is `cached + input`. In this schema `inputTokens` is *fresh* (uncached) input, so the two columns sum to total input.
- Below a floor of **10 000** total input tokens the band is `insufficient_data` and `rate` is `null`. A 100 % rate off one small run is noise, not a signal.
- Bands are `low` / `moderate` / `good`. The thresholds are a first-pass heuristic, chosen so that idea 037's own worked example (31 % — "low") reads as low. They live in one exported constant so they can be retuned once there is real fleet data to calibrate against; this is stated as a known-arbitrary choice, not a measured one.
- Negative inputs clamp to zero.

Both symbols must be exported from **their module and the top-level `packages/shared/src/index.ts` barrel**. Server code imports from `@paperclipai/shared`; a symbol added to only one barrel resolves to `undefined` at runtime.

## 5. UI

Three components stop hardcoding dollars and read the descriptor instead:

| Component | Change |
|-----------|--------|
| `BudgetPolicyCard` | Formatting, input parsing via `inputScale`, validation copy. Currently calls `formatCents` at five sites plus two dollar-specific validation strings. |
| `BudgetIncidentCard` | Formatting; the raise default becomes `max(observed + raiseIncrement, limit)` instead of the hardcoded `observed + 1000` (i.e. +$10), which is meaningless in tokens. |
| `ApprovalPayload` | Formatting; shows the descriptor's label instead of the raw metric slug. |

A `formatBudgetAmount(metric, n)` helper in `ui/src/lib/utils.ts` dispatches to the existing `formatCents` / `formatTokens`.

**Creation path.** A dollars | tokens toggle is added to the budget controls on `AgentDetail` and `ProjectDetail`, and to the company monthly budget control — the places the Costs tab's own empty-state copy already directs operators to ("Set agent and project budgets from their detail pages"). No new page or route. The Costs tab remains a read-and-edit view of policies that exist.

**Bug fix, required before a second metric ships.** `Costs.tsx:949` calls `policyMutation.mutate` without `metric`, which the validator defaults to `billed_cents`. Editing a token policy's amount from the Costs tab would therefore upsert a *dollar* policy at the same scope — creating a second policy rather than editing the one on screen. It must pass `summary.metric` through. This is latent today only because one metric exists.

**Cache-hit rate** appears on the Costs page as a company-level figure and a per-agent column, computed client-side from rows already fetched. No new endpoint and no new query: `inputTokens` and `cachedInputTokens` are already on every row of the existing response.

## 6. Testing

Three shapes, following existing repo conventions.

**Pure, no DB.** `computeCacheHitRate`: band boundaries, the volume floor, zero denominator, negative inputs. Plus a completeness assertion over `BUDGET_METRIC_META` against `BUDGET_METRICS`.

**Stub-based**, extending `server/src/__tests__/budgets-service.test.ts`. This suite is *not* embedded-postgres — it drives `budgetService` against a hand-rolled `createDbStub` that returns queued select results. It can therefore verify **dispatch logic** but not SQL:

- `evaluateCostEvent` no longer skips a token policy, and still skips `amount <= 0`;
- `findBlockingPolicy` returns the first breaching policy when a scope carries two, and the block reason names its metric;
- an unrecognised metric computes `0` and does not block.

**Embedded-postgres**, a new suite modelled on `server/src/__tests__/predictive-breaker.integration.test.ts`, which already seeds `budget_policies` against a real database via `getEmbeddedPostgresTestSupport` / `startEmbeddedPostgresTestDatabase` / `createDb`. Only a real database can verify the parts that are SQL:

- a token policy's observed amount equals the sum of all three token columns over the window;
- a dollar policy and a token policy coexist at one scope and are evaluated independently;
- a token hard stop pauses the scope and opens an incident with an approval;
- an amount above the old `int4` ceiling round-trips through upsert and read — the assertion that actually exercises the migration.

The new file does not match `/(route|routes|authz)\.test\.ts$/`, so it runs in the general-server lane. It should **not** be added to `additionalSerializedServerTests` in `scripts/run-vitest-stable.mjs`: only 25 of the 109 embedded-pg suites are registered there, and the general lane is already `--no-file-parallelism --maxWorkers=1`.

**jsdom UI**, per repo convention — `@testing-library/react` is not installed, so tests set `IS_REACT_ACT_ENVIRONMENT`, render via `react-dom/client` `createRoot` inside React's `act`, and assert on the DOM. Mirror `ui/src/pages/ApprovalDetail.autoApprove.test.tsx`. Cover `BudgetPolicyCard` in both units, the incident card's token raise default, and the cache-hit figure on Costs.

**Migration verification:** `pnpm --filter @paperclipai/db check:migrations`.

No new route files, so `openapi-routes.test.ts` needs no registration — the trap that made `master` red for weeks during Combo 05 does not apply here.

## 7. Risks

- **The token hard stop has genuine teeth**, unlike Combo 05's latent ones: it pauses the scope and cancels work. It is opt-in twice over — no token policy exists until an operator creates one, and `hardStopEnabled` is per-policy — but this is a real production behaviour and should be called out in the PR.
- **The `int4 → bigint` rewrite** takes a brief exclusive lock on `budget_policies` and `budget_incidents`. Both are small.
- **`bigint({ mode: "number" })` returns a JS number**, so the validator gains an upper bound at `Number.MAX_SAFE_INTEGER`; values beyond 2^53 would lose precision silently.
- **The cache-hit bands are unmeasured.** They are a presentation heuristic over an exact underlying ratio; the rate itself is precise, only the low/moderate/good labelling is a judgement call.

## Exit criteria

- [ ] An operator can create a `total_tokens` budget on a company, agent or project from the UI.
- [ ] A token budget accumulates observed usage from `cost_events` and warns at `warnPercent`.
- [ ] A token hard stop pauses the scope, opens an incident, and can be resolved by raising the budget in tokens.
- [ ] A scope carrying both a dollar and a token policy is blocked by whichever binds first.
- [ ] Cache-hit rate is visible per company and per agent on the Costs page, with an honest `insufficient_data` state.
- [ ] Dollar budgets behave exactly as before. The regression surface is the existing `budgets-service.test.ts`, `predictive-breaker.integration.test.ts` and the budget-touching heartbeat suites all passing unchanged.
