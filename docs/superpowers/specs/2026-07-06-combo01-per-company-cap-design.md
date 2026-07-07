# Combo-01 — Per-company concurrency cap (design)

**Date:** 2026-07-06
**Status:** Approved design, pre-implementation
**Builds on:** the merged Phase 1 instance-admission slice
(`2026-07-06-combo01-phase1-admission-design.md`)

## Goal

Add a **per-company** cap on concurrently running agent runs, enforced at the same single
admission choke point as the instance cap, resolved through the **same** precedence-ordered
resolver (generalized to be scope-agnostic). No-op until an operator sets a company's cap.

## Governing decision

The per-company cap flows through the resolver, not around it — preserving combo-01's
single cap-resolution path so later per-company writers (panic/drain, breaker) plug in
without a second code path. This is justified now (unlike a speculative abstraction) because
the company cap is a real, immediate consumer of the generalized resolver.

## In scope

1. **Generalize the resolver** to be scope-agnostic.
2. **`companies.maxConcurrentRuns`** — new nullable column; unset ⇒ unlimited.
3. **`countRunningRunsForCompany(companyId)`** in `heartbeat.ts`.
4. **Admission seam** — add the company ceiling: `budget = min(availableSlots, instanceSlots?, companySlots?)`.

## Out of scope

Per-company panic/drain or breaker writers (Phase 2/3); UI surfacing of the company cap;
reconciler (deferred to Phase 2, per the Phase-1 analysis — recompute-under-lock has no
persistent counter to leak, and existing recovery reclaims dead running rows).

## Architecture & components

### 1. Resolver generalization (`server/src/services/effective-cap-resolver.ts`)

- Rename the context field `instanceMaxConcurrentRuns` → `configuredMax` (generic across
  scopes). `configuredDefaultWriter.resolve(ctx)` returns `ctx.configuredMax`.
- `CAP_WRITER_PRECEDENCE`, `PHASE1_WRITERS`, and the first-non-null-wins reduction are
  unchanged. Callers invoke `resolveEffectiveCap` once per scope:
  `resolveEffectiveCap({ configuredMax: instanceCap }, PHASE1_WRITERS)` and
  `resolveEffectiveCap({ configuredMax: companyCap }, PHASE1_WRITERS)`.
- Update resolver unit tests for the renamed field.

### 2. Data model

- Nullable `maxConcurrentRuns` integer column on `companies`
  (`packages/db/src/schema/companies.ts`), default `null` = unlimited.
- Generated drizzle migration (next number after `0030`, respecting `check:migrations`).
- `heartbeatRuns.companyId` already exists ⇒ per-company count is filter-only, no join.

### 3. Count helper (`heartbeat.ts`, beside `countRunningRunsInstanceWide`)

```ts
async function countRunningRunsForCompany(companyId: string) {
  // count(*) from heartbeatRuns WHERE company_id = ? AND status = "running"
}
```

## Data flow (in `startNextQueuedRunForAgent`)

```
instanceCap = resolve(configuredMax: instanceSetting.maxConcurrentRuns)   // fail-open → null
companyCap  = resolve(configuredMax: companies.maxConcurrentRuns[agent.companyId]) // fail-open → null

if instanceCap === null && companyCap === null:
    claimUpTo(availableSlots)                    // no lock, no counts — byte-identical no-op
else:
    withInstanceAdmissionLock(async () => {       // reuse the SAME single global lock
        let budget = availableSlots
        if instanceCap !== null: budget = min(budget, max(0, instanceCap − countRunningRunsInstanceWide()))
        if companyCap  !== null: budget = min(budget, max(0, companyCap  − countRunningRunsForCompany(agent.companyId)))
        claimUpTo(budget)
    })
```

The single global admission lock already serializes all admission, so both scope counts are
consistent under it — no separate per-company lock. A scope is counted only when its cap is
set (no wasted queries). `claimQueuedRun`'s synchronous atomic `queued→running` flip remains
the correctness anchor for cross-tick counting.

## Error handling & failure modes

- Each cap lookup is **independently** wrapped: a `companies` read error ⇒ that scope treated
  as unlimited (`null`), never a halt. Instance and company failures don't affect each other.
- Same fail-safe profile as Phase 1: over-counting only under-admits, never breaches. Both
  caps unset ⇒ true no-op (no lock, no count queries).

## Testing (TDD, red-first)

Reuse the `heartbeat-instance-admission` embedded-pg harness; real DB, no mocks.

**Resolver unit tests** — updated for the `configuredMax` rename; writer echoes `configuredMax`;
resolves independently per scope.

**Data model** — `companies.maxConcurrentRuns` persists (nullable, unset default).

**Count** — `countRunningRunsForCompany`: seed running rows in **two** companies ⇒ asserts the
count isolates by company (does not include the other company's runs).

**Admission integration:**
- **Company cap alone:** company A capped at 3, saturate two agents in A ⇒ A's running never
  exceeds 3; **company B is unaffected** (proves per-company isolation).
- **min across scopes:** instance cap 10 + company cap 3 ⇒ company-bound to 3; instance cap 3
  + company cap 10 ⇒ instance-bound to 3.
- **Both unset ⇒ no-op** (regression guard — no lock).
- **Fail-open:** a company-cap lookup throw ⇒ falls back to instance/per-agent, runs still start.

**Regression:** heartbeat dependency/retry suites stay green.

## Definition of done

- All tests above pass (each red-first).
- Company `maxConcurrentRuns` unset ⇒ no behavioral change.
- With a company cap set, that company's instance-wide running never exceeds it, and other
  companies are unaffected.
- Instance and company caps compose: effective budget is the tightest of per-agent, instance,
  and company.
