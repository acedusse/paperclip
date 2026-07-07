# Combo-01 Per-Company Concurrency Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-company cap on concurrently running agent runs, enforced at the same admission choke point as the instance cap, resolved through the same (now scope-agnostic) resolver.

**Architecture:** Generalize the Phase-1 resolver's context field to `configuredMax` and call it once per scope. Add a nullable `companies.maxConcurrentRuns` column and a `countRunningRunsForCompany` helper. In `startNextQueuedRunForAgent`, resolve both caps; when either is set, enter the existing global admission lock and set `budget = min(availableSlots, instanceSlots?, companySlots?)`.

**Tech Stack:** TypeScript, Drizzle ORM + drizzle-kit migrations, Vitest, embedded Postgres (`heartbeat-instance-admission` harness).

## Global Constraints

- Unset company cap ⇒ unlimited ⇒ no behavioral change. Both caps unset ⇒ true no-op (no lock, no count queries) — dedicated regression test.
- Per-company cap flows through `resolveEffectiveCap` (the single cap-resolution path), NOT a bypass.
- Fail-open: each cap lookup independently caught → that scope treated as `null` (unlimited); never halts run execution.
- Reuse the single global `withInstanceAdmissionLock`; do NOT add a per-company lock.
- Company column name is snake_case `max_concurrent_runs` (matches `budget_monthly_cents` etc.); nullable, no default (⇒ null).
- Source files keep their `// [START: module]` / `// [END: module]` nav tags.
- Do NOT modify recovery/scheduled-retry code.

## File Structure

- Modify `server/src/services/effective-cap-resolver.ts` — rename context field to `configuredMax`.
- Modify `server/src/services/effective-cap-resolver.test.ts` — update for the rename.
- Modify `server/src/services/heartbeat.ts` — update the existing resolver caller (Task 1); add `countRunningRunsForCompany` + `getCompanyMaxConcurrentRuns` + the company ceiling in the seam (Tasks 3–4).
- Modify `packages/db/src/schema/companies.ts` — add `maxConcurrentRuns` column.
- Create `packages/db/src/migrations/<next>_*.sql` — generated ALTER (Task 2).
- Modify `server/src/__tests__/heartbeat-instance-admission.test.ts` — company count + admission tests.

---

### Task 1: Generalize the resolver context field

**Files:**
- Modify: `server/src/services/effective-cap-resolver.ts`
- Modify: `server/src/services/effective-cap-resolver.test.ts`
- Modify: `server/src/services/heartbeat.ts` (the one existing caller, ~line 8279)

**Interfaces:**
- Consumes: nothing.
- Produces: `type CapContext = { configuredMax: number | null }`; `resolveEffectiveCap(ctx, writers)` unchanged in shape; `configuredDefaultWriter.resolve(ctx)` returns `ctx.configuredMax`.

- [ ] **Step 1: Update the resolver tests for the rename**

In `effective-cap-resolver.test.ts`, replace every `instanceMaxConcurrentRuns` with `configuredMax`. Specifically the two call sites:

```typescript
    const { cap, source } = resolveEffectiveCap({ configuredMax: 10 }, writers);
```
```typescript
    expect(resolveEffectiveCap({ configuredMax: 7 }, PHASE1_WRITERS).cap).toBe(7);
```
and the `configured-default writer echoes` test:
```typescript
    expect(configuredDefaultWriter.resolve({ configuredMax: 5 })).toBe(5);
    expect(configuredDefaultWriter.resolve({ configuredMax: null })).toBeNull();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/services/effective-cap-resolver.test.ts`
Expected: FAIL — `configuredMax` does not exist on `CapContext` (type error / undefined).

- [ ] **Step 3: Rename the field in the resolver**

In `effective-cap-resolver.ts`:
```typescript
export type CapContext = { configuredMax: number | null };
```
and:
```typescript
export const configuredDefaultWriter: CapWriter = {
  name: "configured-default",
  precedence: CAP_WRITER_PRECEDENCE.indexOf("configured-default"),
  resolve: (ctx) => ctx.configuredMax,
};
```

- [ ] **Step 4: Update the existing caller in heartbeat.ts**

In `server/src/services/heartbeat.ts`, the instance-cap resolution currently reads:
```typescript
        ({ cap } = resolveEffectiveCap(
          { instanceMaxConcurrentRuns: general.maxConcurrentRuns ?? null },
          PHASE1_WRITERS,
        ));
```
Change the object key to `configuredMax`:
```typescript
        ({ cap } = resolveEffectiveCap(
          { configuredMax: general.maxConcurrentRuns ?? null },
          PHASE1_WRITERS,
        ));
```

- [ ] **Step 5: Run tests + typecheck to verify green**

Run: `cd server && npx vitest run src/services/effective-cap-resolver.test.ts`
Expected: PASS (5 tests).
Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts`
Expected: PASS (8 tests — the caller rename didn't change behavior).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/effective-cap-resolver.ts server/src/services/effective-cap-resolver.test.ts server/src/services/heartbeat.ts
git commit -m "refactor(admission): make cap resolver scope-agnostic (configuredMax)"
```

---

### Task 2: Add `companies.maxConcurrentRuns` column + migration

**Files:**
- Modify: `packages/db/src/schema/companies.ts`
- Create: `packages/db/src/migrations/<next-number>_*.sql` (generated)
- Test: `server/src/__tests__/heartbeat-instance-admission.test.ts` (add a persistence test)

**Interfaces:**
- Consumes: nothing.
- Produces: `companies.maxConcurrentRuns` (Drizzle column, `number | null`).

- [ ] **Step 1: Add the column to the schema**

In `packages/db/src/schema/companies.ts`, add after `spentMonthlyCents` (nullable ⇒ unlimited):
```typescript
    maxConcurrentRuns: integer("max_concurrent_runs"),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @paperclipai/db generate`
Expected: a new file `packages/db/src/migrations/<NNNN>_*.sql` containing:
```sql
ALTER TABLE "companies" ADD COLUMN "max_concurrent_runs" integer;
```
Verify the numbering check passed (the `generate` script runs `check:migrations` first). If drizzle-kit prompts, accept the additive column (no data loss). Do NOT hand-edit the number — use whatever `generate` assigns.

- [ ] **Step 3: Write the failing persistence test**

Add to `server/src/__tests__/heartbeat-instance-admission.test.ts` (inside the embedded-pg describe block; reuse its `db` and company-creation helper):
```typescript
it("persists a per-company maxConcurrentRuns (nullable, unset by default)", async () => {
  const companyId = await createCompany(db); // existing helper in this file
  const [before] = await db.select({ max: companies.maxConcurrentRuns })
    .from(companies).where(eq(companies.id, companyId));
  expect(before.max).toBeNull();

  await db.update(companies).set({ maxConcurrentRuns: 3 }).where(eq(companies.id, companyId));
  const [after] = await db.select({ max: companies.maxConcurrentRuns })
    .from(companies).where(eq(companies.id, companyId));
  expect(after.max).toBe(3);
});
```
Ensure `companies` and `eq` are imported at the top of the test file (add to the existing `@paperclipai/db` / `drizzle-orm` imports if missing).

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts -t maxConcurrentRuns`
Expected: FAIL before the migration is applied by the harness (unknown column) → PASS once the generated migration is in place. If the embedded-pg harness needs a rebuild to pick up the new migration, run `pnpm --filter @paperclipai/db build` first.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/companies.ts packages/db/src/migrations/ server/src/__tests__/heartbeat-instance-admission.test.ts
git commit -m "feat(admission): add companies.maxConcurrentRuns column"
```

---

### Task 3: `countRunningRunsForCompany` helper

**Files:**
- Modify: `server/src/services/heartbeat.ts` (beside `countRunningRunsInstanceWide`, ~line 7248)
- Test: `server/src/__tests__/heartbeat-instance-admission.test.ts`

**Interfaces:**
- Consumes: `heartbeatRuns` (has `companyId`).
- Produces: module-local `async function countRunningRunsForCompany(companyId: string): Promise<number>`, exposed on the service return object (plain name, like `countRunningRunsInstanceWide`).

- [ ] **Step 1: Write the failing test**

Add to `heartbeat-instance-admission.test.ts` (reuse existing helpers to create two companies, agents, and running/queued rows):
```typescript
it("counts running runs for one company, isolated from others", async () => {
  const companyA = await createCompany(db);
  const companyB = await createCompany(db);
  const agentA = await createAgentInCompany(db, companyA);
  const agentB = await createAgentInCompany(db, companyB);
  await insertRun(db, { companyId: companyA, agentId: agentA, status: "running" });
  await insertRun(db, { companyId: companyA, agentId: agentA, status: "running" });
  await insertRun(db, { companyId: companyA, agentId: agentA, status: "queued" });
  await insertRun(db, { companyId: companyB, agentId: agentB, status: "running" });

  const heartbeat = heartbeatService(db);
  expect(await heartbeat.countRunningRunsForCompany(companyA)).toBe(2);
  expect(await heartbeat.countRunningRunsForCompany(companyB)).toBe(1);
});
```
> Use the same row-insertion / company / agent helpers the file already defines for the instance-count test. If a helper you need (e.g. `createAgentInCompany`, `insertRun`) doesn't exist yet, add a small one mirroring the existing setup — do not invent a new harness style.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts -t "isolated from others"`
Expected: FAIL — `heartbeat.countRunningRunsForCompany is not a function`.

- [ ] **Step 3: Implement the helper**

In `server/src/services/heartbeat.ts`, immediately after `countRunningRunsInstanceWide` (ends ~line 7254):
```typescript
  async function countRunningRunsForCompany(companyId: string) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.status, "running")));
    return Number(count ?? 0);
  }
```
Add `countRunningRunsForCompany,` to the object the service returns (next to `countRunningRunsInstanceWide,`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts -t "isolated from others"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/heartbeat-instance-admission.test.ts
git commit -m "feat(admission): per-company running-run count"
```

---

### Task 4: Add the company ceiling to the admission seam

**Files:**
- Modify: `server/src/services/heartbeat.ts` (the gated block in `startNextQueuedRunForAgent`, ~lines 8274–8302, and a small company-cap accessor)
- Test: `server/src/__tests__/heartbeat-instance-admission.test.ts`

**Interfaces:**
- Consumes: `resolveEffectiveCap`, `PHASE1_WRITERS` (Task 1); `countRunningRunsInstanceWide`, `countRunningRunsForCompany` (Task 3); `companies.maxConcurrentRuns` (Task 2); `withInstanceAdmissionLock`.
- Produces: gated claim loop with `budget = min(availableSlots, instanceSlots?, companySlots?)`.

- [ ] **Step 1: Write the failing tests**

Add to `heartbeat-instance-admission.test.ts` (reuse `createAgents`/`saturateQueue`/`runTickForAllAgents`/`countRunning` and a `countRunningForCompany(db, id)` helper):
```typescript
it("caps a company's running runs and leaves other companies unaffected", async () => {
  const companyA = await createCompany(db);
  const companyB = await createCompany(db);
  await db.update(companies).set({ maxConcurrentRuns: 3 }).where(eq(companies.id, companyA));
  const agentsA = await createAgents(companyA, 3, { maxConcurrentRuns: 20 });
  const agentsB = await createAgents(companyB, 2, { maxConcurrentRuns: 20 });
  await saturateQueue(companyA, agentsA, 20);
  await saturateQueue(companyB, agentsB, 20);
  for (let t = 0; t < 3; t++) {
    await runTickForAllAgents([...agentsA, ...agentsB]);
    expect(await countRunningForCompany(db, companyA)).toBeLessThanOrEqual(3);
  }
  // Company B (uncapped) is not throttled by A's cap:
  expect(await countRunningForCompany(db, companyB)).toBeGreaterThan(3);
});

it("binds on the tighter of instance and company caps", async () => {
  const company = await createCompany(db);
  await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });
  await db.update(companies).set({ maxConcurrentRuns: 3 }).where(eq(companies.id, company));
  const agents = await createAgents(company, 3, { maxConcurrentRuns: 20 });
  await saturateQueue(company, agents, 20);
  await runTickForAllAgents(agents);
  expect(await countRunning(db)).toBeLessThanOrEqual(3); // company cap (3) binds under instance (10)
});

it("is a no-op when neither instance nor company cap is set", async () => {
  const company = await createCompany(db);
  const agents = await createAgents(company, 3, { maxConcurrentRuns: 2 });
  await saturateQueue(company, agents, 5);
  await runTickForAllAgents(agents);
  expect(await countRunning(db)).toBe(6); // 3 agents × per-agent 2, no global lock/count
});

it("falls back (fail-open) when the company cap lookup throws", async () => {
  const company = await createCompany(db);
  await db.update(companies).set({ maxConcurrentRuns: 1 }).where(eq(companies.id, company));
  const spy = vi.spyOn(companyCapModule, "getCompanyMaxConcurrentRuns").mockRejectedValue(new Error("db blip"));
  const agents = await createAgents(company, 2, { maxConcurrentRuns: 2 });
  await saturateQueue(company, agents, 5);
  await runTickForAllAgents(agents);
  expect(await countRunning(db)).toBe(4); // company gate bypassed → per-agent only
  spy.mockRestore();
});
```
> If `getCompanyMaxConcurrentRuns` is a module-local closure (not separately importable), make the fail-open test force the throw a different way — e.g. spy the `db.select` used by the accessor, or (cleaner) assert fail-open by pointing the company cap at a company row that is then deleted mid-test. Choose whichever the harness supports; the required property is: a thrown company-cap lookup ⇒ runs still start (count 4), never a halt. Note in your report which mechanism you used.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts`
Expected: the company-cap cases FAIL (company ceiling not enforced) — company A would exceed 3.

- [ ] **Step 3: Add the company-cap accessor**

In `server/src/services/heartbeat.ts`, near the count helpers, add:
```typescript
  async function getCompanyMaxConcurrentRuns(companyId: string): Promise<number | null> {
    const [row] = await db
      .select({ max: companies.maxConcurrentRuns })
      .from(companies)
      .where(eq(companies.id, companyId));
    return row?.max ?? null;
  }
```
Ensure `companies` is imported from `@paperclipai/db` at the top of `heartbeat.ts` (add to the existing import if missing).

- [ ] **Step 4: Rewrite the gated block to add the company ceiling**

Replace the current instance-only gate (the block that resolves `cap`, then branches on `cap === null` / `withInstanceAdmissionLock`) with:
```typescript
      // Resolve instance + company caps FIRST, outside the lock. Fail open per scope.
      let instanceCap: number | null = null;
      try {
        const general = await instanceSettingsService(db).getGeneral();
        ({ cap: instanceCap } = resolveEffectiveCap(
          { configuredMax: general.maxConcurrentRuns ?? null },
          PHASE1_WRITERS,
        ));
      } catch (err) {
        logger.warn({ err }, "instance admission cap lookup failed; falling back to per-agent only");
        instanceCap = null;
      }
      let companyCap: number | null = null;
      try {
        const companyMax = await getCompanyMaxConcurrentRuns(agent.companyId);
        ({ cap: companyCap } = resolveEffectiveCap({ configuredMax: companyMax }, PHASE1_WRITERS));
      } catch (err) {
        logger.warn({ err }, "company admission cap lookup failed; falling back");
        companyCap = null;
      }

      if (instanceCap === null && companyCap === null) {
        // No cap configured: byte-identical to pre-Phase-1 — per-agent loop, no lock, no counts.
        await claimUpTo(availableSlots);
      } else {
        const iCap = instanceCap;
        const cCap = companyCap;
        await withInstanceAdmissionLock(async () => {
          let budget = availableSlots;
          if (iCap !== null) {
            budget = Math.min(budget, Math.max(0, iCap - (await countRunningRunsInstanceWide())));
          }
          if (cCap !== null) {
            budget = Math.min(budget, Math.max(0, cCap - (await countRunningRunsForCompany(agent.companyId))));
          }
          await claimUpTo(budget);
        });
      }
```
(`agent` is already in scope from the `getAgent(agentId)` call earlier in `startNextQueuedRunForAgent`. The `void executeRun(...)` loop after this block stays unchanged.)

- [ ] **Step 5: Run tests to verify they pass (twice for determinism)**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts`
Expected: PASS (all cases). Run a second time to confirm determinism.

- [ ] **Step 6: Regression + nav sync**

Run: `cd server && npx vitest run src/__tests__/heartbeat-dependency-scheduling.test.ts src/__tests__/heartbeat-retry-scheduling.test.ts`
Expected: PASS (recovery/retry still flow through the gated seam).
Run: `python3 scripts/nav/nav_endhook.py --no-inject` (sync the ledger for changed source without mass-injecting tags into untagged files).

- [ ] **Step 7: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/heartbeat-instance-admission.test.ts
git commit -m "feat(admission): enforce per-company concurrency cap in the seam"
```

---

## Self-review notes

- **Spec coverage:** resolver generalization (Task 1), `companies.maxConcurrentRuns` + migration (Task 2), `countRunningRunsForCompany` (Task 3), seam ceiling + all four spec tests — company-alone isolation, min-across-scopes, both-unset no-op, fail-open (Task 4). Regression covered in Task 4 Step 6.
- **Type consistency:** `configuredMax` used identically in resolver (Task 1) and both seam callers (Task 1 instance caller, Task 4 company caller). `countRunningRunsForCompany` signature identical in Task 3 def and Task 4 use. `getCompanyMaxConcurrentRuns` returns `number | null`, consumed as `configuredMax`.
- **Nav:** Task 4 uses `nav_endhook.py --no-inject` deliberately — the repo's committed files are untagged, and full `--inject` would mass-modify hundreds of files (a known issue from Phase 1).
- **Fail-open test caveat:** Step 1 flags that the exact throw-injection mechanism depends on whether the accessor is importable; the implementer picks the one the harness supports and reports which.
