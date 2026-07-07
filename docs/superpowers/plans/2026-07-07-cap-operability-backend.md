# Cap Operability Backend (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the concurrency caps operable via API — settable (add the company cap; instance cap already is) and observable (running/cap/queued per scope).

**Architecture:** One schema line makes the company cap settable through the existing `PATCH /:companyId` passthrough. Two new heartbeat-service helpers (`getInstanceAdmissionStatus`, `getCompanyAdmissionStatus`) compose the SAME `resolveEffectiveCap` the admission seam uses with running/queued counts. Two thin GET endpoints expose them.

**Tech Stack:** TypeScript, Drizzle, Zod (`@paperclipai/shared`), Express, Vitest, supertest, embedded Postgres.

## Global Constraints

- Company `maxConcurrentRuns`: `z.number().int().positive().nullable().optional()` — positive int = set, `null` = clear, omit = leave. Mirrors the instance validation.
- Admission-status helpers resolve the cap via `resolveEffectiveCap({ configuredMax }, PHASE1_WRITERS)` — the single cap-resolution path (do NOT re-implement precedence). Unset ⇒ `{ cap: null, source: "none", ... }`.
- Each scope reports its OWN configured cap (instance status = instance cap; company status = that company's cap) — not the min.
- Status endpoints are read-only and NOT fail-open: a DB error is a normal 500 (observability must not fabricate numbers). Contrast the admission seam, which fails open.
- No enforcement behavior change; no UI (Slice B).
- Source files keep their `// [START: module]` / `// [END: module]` nav tags.

## File Structure

- Modify `packages/shared/src/validators/company.ts` — add `maxConcurrentRuns` to `updateCompanySchema`.
- Modify `server/src/services/heartbeat.ts` — `countQueuedRunsInstanceWide`, `countQueuedRunsForCompany`, `getInstanceAdmissionStatus`, `getCompanyAdmissionStatus` (+ expose on the service object).
- Modify `server/src/routes/instance-settings.ts` — `GET /instance/admission-status`.
- Modify `server/src/routes/companies.ts` — build `heartbeatService(db)`; `GET /:companyId/admission-status`.
- Tests: `server/src/__tests__/heartbeat-instance-admission.test.ts` (helpers), `server/src/__tests__/companies.test.ts` or a route test (company PATCH), and route tests mirroring `instance-settings-routes.test.ts`.

---

### Task 1: Company-cap settable via updateCompanySchema

**Files:**
- Modify: `packages/shared/src/validators/company.ts` (`updateCompanySchema.extend({...})`, ~line 25-39)
- Test: `server/src/__tests__/heartbeat-instance-admission.test.ts` (persistence via companies service, embedded pg)

**Interfaces:**
- Consumes: existing `companiesService.update`, `companies.maxConcurrentRuns` column.
- Produces: `UpdateCompany.maxConcurrentRuns?: number | null`.

- [ ] **Step 1: Write the failing test** (append to the embedded-pg `describe` block)

```typescript
it("persists and clears a company maxConcurrentRuns via companiesService.update", async () => {
  const companyId = await createCompany(db); // existing helper in this file
  const svc = companyService(db);            // import companyService from ../services/companies.js

  await svc.update(companyId, { maxConcurrentRuns: 5 } as any);
  let [row] = await db.select({ m: companies.maxConcurrentRuns }).from(companies).where(eq(companies.id, companyId));
  expect(row.m).toBe(5);

  await svc.update(companyId, { maxConcurrentRuns: null } as any);
  [row] = await db.select({ m: companies.maxConcurrentRuns }).from(companies).where(eq(companies.id, companyId));
  expect(row.m).toBeNull();
});

it("updateCompanySchema rejects non-positive / non-integer maxConcurrentRuns", async () => {
  const { updateCompanySchema } = await import("@paperclipai/shared");
  expect(updateCompanySchema.safeParse({ maxConcurrentRuns: 3 }).success).toBe(true);
  expect(updateCompanySchema.safeParse({ maxConcurrentRuns: null }).success).toBe(true);
  expect(updateCompanySchema.safeParse({ maxConcurrentRuns: 0 }).success).toBe(false);
  expect(updateCompanySchema.safeParse({ maxConcurrentRuns: -1 }).success).toBe(false);
  expect(updateCompanySchema.safeParse({ maxConcurrentRuns: 1.5 }).success).toBe(false);
});
```
(Ensure `companyService`, `companies`, `eq` are imported at the top of the test file.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts -t "maxConcurrentRuns via companiesService"`
Expected: FAIL — schema strips the field / value not persisted, and the schema-reject test fails because `0`/`-1`/`1.5` currently parse as success (field unknown → stripped).

- [ ] **Step 3: Add the field to updateCompanySchema**

In `packages/shared/src/validators/company.ts`, inside `updateCompanySchema.extend({ ... })`, add:
```typescript
    maxConcurrentRuns: z.number().int().positive().nullable().optional(),
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts -t "maxConcurrentRuns"`
Expected: PASS. If the server can't see the new shared field, rebuild shared: `pnpm --filter @paperclipai/shared build` (note: `@paperclipai/shared` exports `.` → `src`, so a rebuild is usually not needed — confirm which).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/validators/company.ts server/src/__tests__/heartbeat-instance-admission.test.ts
git commit -m "feat(admission): make company maxConcurrentRuns settable via updateCompanySchema"
```

---

### Task 2: Queued-count helpers

**Files:**
- Modify: `server/src/services/heartbeat.ts` (beside `countRunningRunsInstanceWide` / `countRunningRunsForCompany`)
- Test: `server/src/__tests__/heartbeat-instance-admission.test.ts`

**Interfaces:**
- Consumes: `heartbeatRuns` table.
- Produces (module-local, exposed on the service object): `countQueuedRunsInstanceWide(): Promise<number>`, `countQueuedRunsForCompany(companyId: string): Promise<number>`.

- [ ] **Step 1: Write the failing test**

```typescript
it("counts queued runs instance-wide and per-company, excluding running", async () => {
  const companyA = await createCompany(db);
  const companyB = await createCompany(db);
  const agentA = await createAgentInCompany(db, companyA);
  const agentB = await createAgentInCompany(db, companyB);
  await insertRun(db, { companyId: companyA, agentId: agentA, status: "queued" });
  await insertRun(db, { companyId: companyA, agentId: agentA, status: "queued" });
  await insertRun(db, { companyId: companyA, agentId: agentA, status: "running" });
  await insertRun(db, { companyId: companyB, agentId: agentB, status: "queued" });

  const heartbeat = heartbeatService(db);
  expect(await heartbeat.countQueuedRunsInstanceWide()).toBe(3);
  expect(await heartbeat.countQueuedRunsForCompany(companyA)).toBe(2);
  expect(await heartbeat.countQueuedRunsForCompany(companyB)).toBe(1);
});
```
(Reuse the `createAgentInCompany` / `insertRun` helpers already added for the running-count tests.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts -t "counts queued runs"`
Expected: FAIL — `heartbeat.countQueuedRunsInstanceWide is not a function`.

- [ ] **Step 3: Implement the helpers**

In `server/src/services/heartbeat.ts`, immediately after `countRunningRunsForCompany`:
```typescript
  async function countQueuedRunsInstanceWide() {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.status, "queued"));
    return Number(count ?? 0);
  }

  async function countQueuedRunsForCompany(companyId: string) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.status, "queued")));
    return Number(count ?? 0);
  }
```
Add `countQueuedRunsInstanceWide,` and `countQueuedRunsForCompany,` to the object the service returns.

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts -t "counts queued runs"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/heartbeat-instance-admission.test.ts
git commit -m "feat(admission): queued-run count helpers (instance + per-company)"
```

---

### Task 3: Admission-status helpers

**Files:**
- Modify: `server/src/services/heartbeat.ts`
- Test: `server/src/__tests__/heartbeat-instance-admission.test.ts`

**Interfaces:**
- Consumes: `resolveEffectiveCap`, `PHASE1_WRITERS`; `instanceSettingsService(db).getGeneral()`; `getCompanyMaxConcurrentRuns` (existing module-local accessor); the running/queued count helpers.
- Produces (exposed on the service object):
  - `type AdmissionStatus = { cap: number | null; source: string; running: number; queued: number }`
  - `getInstanceAdmissionStatus(): Promise<AdmissionStatus>`
  - `getCompanyAdmissionStatus(companyId: string): Promise<AdmissionStatus>`

- [ ] **Step 1: Write the failing test**

```typescript
it("reports instance admission status (cap/source/running/queued)", async () => {
  await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });
  const company = await createCompany(db);
  const agent = await createAgentInCompany(db, company);
  await insertRun(db, { companyId: company, agentId: agent, status: "running" });
  await insertRun(db, { companyId: company, agentId: agent, status: "queued" });

  const heartbeat = heartbeatService(db);
  const s = await heartbeat.getInstanceAdmissionStatus();
  expect(s).toEqual({ cap: 10, source: "configured-default", running: 1, queued: 1 });
});

it("reports company admission status, unset cap => null/none, isolated per company", async () => {
  const companyA = await createCompany(db);
  const companyB = await createCompany(db);
  await db.update(companies).set({ maxConcurrentRuns: 3 }).where(eq(companies.id, companyA));
  const agentA = await createAgentInCompany(db, companyA);
  await insertRun(db, { companyId: companyA, agentId: agentA, status: "running" });

  const heartbeat = heartbeatService(db);
  expect(await heartbeat.getCompanyAdmissionStatus(companyA)).toEqual({
    cap: 3, source: "configured-default", running: 1, queued: 0,
  });
  expect(await heartbeat.getCompanyAdmissionStatus(companyB)).toEqual({
    cap: null, source: "none", running: 0, queued: 0,
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts -t "admission status"`
Expected: FAIL — `getInstanceAdmissionStatus is not a function`.

- [ ] **Step 3: Implement the helpers**

In `server/src/services/heartbeat.ts`, near the count helpers:
```typescript
  async function getInstanceAdmissionStatus() {
    const general = await instanceSettingsService(db).getGeneral();
    const { cap, source } = resolveEffectiveCap(
      { configuredMax: general.maxConcurrentRuns ?? null },
      PHASE1_WRITERS,
    );
    return {
      cap,
      source,
      running: await countRunningRunsInstanceWide(),
      queued: await countQueuedRunsInstanceWide(),
    };
  }

  async function getCompanyAdmissionStatus(companyId: string) {
    const { cap, source } = resolveEffectiveCap(
      { configuredMax: await getCompanyMaxConcurrentRuns(companyId) },
      PHASE1_WRITERS,
    );
    return {
      cap,
      source,
      running: await countRunningRunsForCompany(companyId),
      queued: await countQueuedRunsForCompany(companyId),
    };
  }
```
Add both to the returned service object. (`instanceSettingsService` is already imported/used in heartbeat.ts; if not, import from `./instance-settings.js`.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run src/__tests__/heartbeat-instance-admission.test.ts -t "admission status"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/heartbeat-instance-admission.test.ts
git commit -m "feat(admission): instance + company admission-status helpers"
```

---

### Task 4: Read endpoints

**Files:**
- Modify: `server/src/routes/instance-settings.ts` (`GET /instance/admission-status`)
- Modify: `server/src/routes/companies.ts` (build `heartbeatService(db)`; `GET /:companyId/admission-status`)
- Test: `server/src/__tests__/instance-admission-status-routes.test.ts` (new; mirror `instance-settings-routes.test.ts` supertest harness + embedded pg)

**Interfaces:**
- Consumes: `heartbeat.getInstanceAdmissionStatus()`, `heartbeat.getCompanyAdmissionStatus(companyId)` (Task 3).
- Produces: `GET /instance/admission-status`, `GET /companies/:companyId/admission-status` returning `AdmissionStatus` JSON.

- [ ] **Step 1: Write the failing route tests**

Create `server/src/__tests__/instance-admission-status-routes.test.ts`. Mirror the `createApp(actor)` supertest harness from `instance-settings-routes.test.ts` (express + `req.actor = actor` middleware + `errorHandler`), but mount the router with a REAL embedded-pg `db` (from the `embedded-postgres.ts` helper) so the status reflects seeded rows:

```typescript
it("GET /api/instance/admission-status returns cap/running/queued", async () => {
  await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });
  const company = await createCompany(db);
  const agent = await createAgentInCompany(db, company);
  await insertRun(db, { companyId: company, agentId: agent, status: "running" });

  const app = createApp({ type: "board", source: "local_implicit", isInstanceAdmin: true }, db);
  const res = await request(app).get("/api/instance/admission-status");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ cap: 10, source: "configured-default", running: 1, queued: 0 });
});

it("GET /api/companies/:id/admission-status returns that company's status", async () => {
  const company = await createCompany(db);
  await db.update(companies).set({ maxConcurrentRuns: 3 }).where(eq(companies.id, company));
  const app = createCompanyApp({ type: "board", source: "local_implicit", isInstanceAdmin: true }, db);
  const res = await request(app).get(`/api/companies/${company}/admission-status`);
  expect(res.status).toBe(200);
  expect(res.body.cap).toBe(3);
});
```
> `createApp`/`createCompanyApp` mount `instanceSettingsRoutes(db)` / `companyRoutes(db)` under `/api` with an actor-injecting middleware and `errorHandler`, exactly like the existing `instance-settings-routes.test.ts` `createApp` — but pass the real embedded-pg `db` instead of `{} as any`. Reuse the `createCompany`/`createAgentInCompany`/`insertRun` helpers.

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run src/__tests__/instance-admission-status-routes.test.ts`
Expected: FAIL — routes return 404 (endpoints not defined yet).

- [ ] **Step 3: Add the instance endpoint**

In `server/src/routes/instance-settings.ts`, alongside `GET /instance/settings` (uses the existing `heartbeat` and `assertBoardOrgAccess`):
```typescript
  router.get("/instance/admission-status", async (req, res) => {
    assertBoardOrgAccess(req);
    res.json(await heartbeat.getInstanceAdmissionStatus());
  });
```

- [ ] **Step 4: Add the company endpoint**

In `server/src/routes/companies.ts`: add `heartbeatService` to the import from `../services/index.js`, build it in the factory (`const heartbeat = heartbeatService(db);` next to the other services), and add:
```typescript
  router.get("/:companyId/admission-status", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await heartbeat.getCompanyAdmissionStatus(companyId));
  });
```
Place it before any broad `/:companyId/*` catch-alls but consistent with sibling GET routes.

- [ ] **Step 5: Run to verify it passes**

Run: `cd server && npx vitest run src/__tests__/instance-admission-status-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Regression + nav sync**

Run: `cd server && npx vitest run src/__tests__/instance-settings-routes.test.ts src/__tests__/heartbeat-instance-admission.test.ts`
Expected: PASS (existing route + admission suites unaffected).
Run: `python3 scripts/nav/nav_endhook.py --no-inject` (sync ledger for changed source; `--no-inject` is required — a bare run mass-injects tags).

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/instance-settings.ts server/src/routes/companies.ts server/src/__tests__/instance-admission-status-routes.test.ts
git commit -m "feat(admission): GET admission-status endpoints (instance + company)"
```

---

## Self-review notes

- **Spec coverage:** company-cap API (Task 1), queued-count helpers (Task 2), admission-status helpers resolving via the shared resolver (Task 3), both endpoints + auth (Task 4). Error handling: schema-reject 400 (Task 1), read-only 500 is default Express behavior (no fail-open added). All spec tests mapped.
- **Type consistency:** `AdmissionStatus { cap, source, running, queued }` identical in Task 3 def and Task 4 use; `getInstanceAdmissionStatus`/`getCompanyAdmissionStatus`/`countQueued*` names consistent across tasks; `configuredMax` matches the resolver's field.
- **Auth:** instance endpoint uses `assertBoardOrgAccess` (matches `GET /instance/settings`); company endpoint uses `assertCompanyAccess` (matches `GET /:companyId`).
- **Nav:** Task 4 uses `nav_endhook.py --no-inject` (committed repo files are untagged; bare `--inject` mass-modifies them — a known issue).
