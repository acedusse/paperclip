# Path-Level Soft-Claim Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent declare a subtree claim in a shared workspace via an authenticated HTTP route; detect + audit overlaps with other runs' active claims (never blocking); release claims on run-end and expire them via the first reconciler TTL source.

**Architecture:** A pure overlap module, a new `workspace_path_claims` table + service (mirroring `environment_leases`), an agent-JWT route, a run-end release hook, and a reconciler expiry source. No behavior change to admission/execution beyond one fault-isolated reconciler source.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres) + drizzle-kit, Express + supertest, Vitest + embedded Postgres, `logActivity`, the local-agent JWT (`req.actor`).

## Global Constraints

- **Base branch:** `feat/combo-01-workspace-path-claims` (off `master`, which has the merged slice-1 detection).
- **Advisory, non-blocking:** acquiring a claim that overlaps another run's active claim MUST succeed; overlap is audited (`workspace_path_claim_conflict`) and returned in the response, never prevents the claim or any edit.
- **No DB unique constraint** on the claim table (overlaps allowed + detected, not DB-enforced).
- **Two reclamation paths:** run-end release in the `executeRun` `finally` (any outcome) + reconciler TTL expiry for crashed runs. `expiresAt = acquiredAt + ttlMs` (default TTL 30 min = 1_800_000 ms).
- **Path model:** normalized POSIX relative subtree; overlap = equal OR segment-aware ancestor-prefix (`src/pay` does NOT overlap `src/payments`); empty/root claims the whole workspace.
- **Identity from local-agent JWT:** the route uses `req.actor.{agentId, companyId, runId}` and verifies the run belongs to that agent+company (mirror `server/src/routes/approvals.ts:92-105`).
- **A claim requires a resolvable shared workspace** for the run (run → `contextSnapshot.issueId` → `issues.executionWorkspaceId` → `execution_workspaces.mode === "shared_workspace"`); otherwise 400.
- **Correct focused test command** (`pnpm --filter … test` silently no-ops): `cd server && npx vitest run <pattern>`; DB gen: `pnpm --filter @paperclipai/db generate`; typecheck `cd server && npx tsc --noEmit` and (repo root) `pnpm -r typecheck`.

---

### Task 1: Pure path-overlap module

**Files:**
- Create: `server/src/services/workspace-path-overlap.ts`
- Test: `server/src/services/workspace-path-overlap.test.ts`

**Interfaces:**
- Produces: `normalizeClaimPath(path: string): string`; `pathsOverlap(a: string, b: string): boolean`; `ClaimLike = { path: string; heartbeatRunId: string | null }`; `detectClaimOverlap(newPath: string, existing: ClaimLike[], excludeRunId?: string): ClaimLike[]`.

- [ ] **Step 1: Write the failing test**

Create `server/src/services/workspace-path-overlap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectClaimOverlap, normalizeClaimPath, pathsOverlap } from "./workspace-path-overlap.js";

describe("normalizeClaimPath", () => {
  it("normalizes separators, trims slashes, collapses dot/empty to root", () => {
    expect(normalizeClaimPath("src\\pay/")).toBe("src/pay");
    expect(normalizeClaimPath("/src/pay/")).toBe("src/pay");
    expect(normalizeClaimPath("./src//pay")).toBe("src/pay");
    expect(normalizeClaimPath("")).toBe("");
    expect(normalizeClaimPath("/")).toBe("");
    expect(normalizeClaimPath(".")).toBe("");
  });
});

describe("pathsOverlap", () => {
  it("equal paths overlap", () => { expect(pathsOverlap("src/pay", "src/pay")).toBe(true); });
  it("ancestor overlaps descendant (both directions)", () => {
    expect(pathsOverlap("src", "src/pay")).toBe(true);
    expect(pathsOverlap("src/pay/api", "src/pay")).toBe(true);
  });
  it("siblings do NOT overlap (segment-aware, not raw prefix)", () => {
    expect(pathsOverlap("src/pay", "src/payments")).toBe(false);
    expect(pathsOverlap("src/a", "src/b")).toBe(false);
  });
  it("root overlaps everything", () => {
    expect(pathsOverlap("", "src/pay")).toBe(true);
    expect(pathsOverlap("anything", "")).toBe(true);
  });
});

describe("detectClaimOverlap", () => {
  const claims = [
    { path: "src/pay", heartbeatRunId: "rA" },
    { path: "docs", heartbeatRunId: "rB" },
    { path: "src/pay/api", heartbeatRunId: "rSelf" },
  ];
  it("returns overlapping claims, excluding the caller's own run", () => {
    expect(detectClaimOverlap("src/pay", claims, "rSelf")).toEqual([{ path: "src/pay", heartbeatRunId: "rA" }]);
  });
  it("returns [] when nothing overlaps", () => {
    expect(detectClaimOverlap("web", claims)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run workspace-path-overlap`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Create `server/src/services/workspace-path-overlap.ts`:

```ts
/** Normalize a claim path to POSIX, no leading/trailing slashes, no "."/empty segments. Root → "". */
export function normalizeClaimPath(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/").filter((s) => s.length > 0 && s !== ".");
  return segments.join("/");
}

/** Two normalized paths overlap iff equal or one is a segment-aware ancestor of the other. Root ("") overlaps all. */
export function pathsOverlap(a: string, b: string): boolean {
  const na = normalizeClaimPath(a);
  const nb = normalizeClaimPath(b);
  if (na === "" || nb === "") return true;
  if (na === nb) return true;
  return nb.startsWith(na + "/") || na.startsWith(nb + "/");
}

export interface ClaimLike {
  path: string;
  heartbeatRunId: string | null;
}

/** Existing claims that overlap newPath, excluding any claim from excludeRunId. */
export function detectClaimOverlap(newPath: string, existing: ClaimLike[], excludeRunId?: string): ClaimLike[] {
  return existing.filter(
    (c) => c.heartbeatRunId !== excludeRunId && pathsOverlap(newPath, c.path),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run workspace-path-overlap`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/workspace-path-overlap.ts server/src/services/workspace-path-overlap.test.ts
git commit -m "feat(workspace): pure path-claim overlap helpers"
```

---

### Task 2: `workspace_path_claims` schema + migration

**Files:**
- Create: `packages/db/src/schema/workspace_path_claims.ts`
- Modify: `packages/db/src/schema/index.ts` (export the new table — follow how `environment_leases` is exported)
- Generated: a new `NNNN_*.sql` migration + journal entry (via drizzle-kit)

**Interfaces:**
- Produces: `workspacePathClaims` Drizzle table, exported from `@paperclipai/db`.

- [ ] **Step 1: Create the schema (mirror `environment_leases.ts`)**

Create `packages/db/src/schema/workspace_path_claims.ts`:

```ts
import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { executionWorkspaces } from "./execution_workspaces.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { agents } from "./agents.js";

export const workspacePathClaims = pgTable(
  "workspace_path_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    executionWorkspaceId: uuid("execution_workspace_id").notNull().references(() => executionWorkspaces.id, { onDelete: "cascade" }),
    heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    path: text("path").notNull(),
    status: text("status").notNull().default("active"),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyWorkspaceStatusIdx: index("workspace_path_claims_company_workspace_status_idx").on(
      table.companyId, table.executionWorkspaceId, table.status,
    ),
    heartbeatRunIdx: index("workspace_path_claims_heartbeat_run_idx").on(table.heartbeatRunId),
    companyExpiresIdx: index("workspace_path_claims_company_expires_idx").on(table.companyId, table.expiresAt),
  }),
);
```

- [ ] **Step 2: Export the table**

In `packages/db/src/schema/index.ts`, add an export line next to the other schema exports (match the `export * from "./environment_leases.js";` style):

```ts
export * from "./workspace_path_claims.js";
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @paperclipai/db generate`
Expected: creates a new `packages/db/src/migrations/NNNN_*.sql` (the `CREATE TABLE "workspace_path_claims"` + indexes) AND appends its journal entry automatically. Do NOT hand-edit the journal.

- [ ] **Step 4: Verify migrations + typecheck**

Run: `cd packages/db && npm run check:migrations && npx tsc -p tsconfig.json --noEmit`
Expected: exits 0; journal entry count == sql file count.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/workspace_path_claims.ts packages/db/src/schema/index.ts packages/db/src/migrations/
git commit -m "feat(db): workspace_path_claims table + migration"
```

---

### Task 3: Claim service (acquire / release / list / expire)

**Files:**
- Create: `server/src/services/workspace-path-claims.ts`
- Test: `server/src/__tests__/workspace-path-claims-service.test.ts` (embedded Postgres, mirror `execution-workspaces-service.test.ts` harness)

**Interfaces:**
- Consumes: `normalizeClaimPath` (Task 1); `workspacePathClaims` (Task 2).
- Produces: `workspacePathClaimService(db)` with:
  - `acquireClaim(input: { companyId; executionWorkspaceId; heartbeatRunId; agentId: string | null; path: string; ttlMs?: number; now?: Date }): Promise<Claim>`
  - `releaseClaimsForRun(heartbeatRunId: string, status?: "released" | "expired" | "failed", now?: Date): Promise<number>`
  - `listActiveClaimsOnWorkspace(executionWorkspaceId: string, excludeRunId?: string): Promise<Claim[]>`
  - `findExpiredClaims(now: Date): Promise<Array<{ id: string }>>`
  - `expireClaim(id: string, now?: Date): Promise<void>`
  - `DEFAULT_CLAIM_TTL_MS = 1_800_000`

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/workspace-path-claims-service.test.ts` (embedded-Postgres harness like Task-2/3 of slice 1; seed `companies`, `agents`, `executionWorkspaces`, `heartbeatRuns`, then exercise). Cover:

```ts
// acquire: inserts status 'active', path normalized, expiresAt = now + ttl
it("acquires an active claim with a normalized path and TTL expiry", async () => {
  const now = new Date("2026-07-13T00:00:00.000Z");
  const claim = await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runA, agentId, path: "/src/pay/", ttlMs: 1000, now });
  expect(claim.status).toBe("active");
  expect(claim.path).toBe("src/pay");
  expect(claim.expiresAt?.getTime()).toBe(now.getTime() + 1000);
});

// listActive: excludes released/expired and the excluded run
it("lists active claims on a workspace, excluding a run", async () => {
  await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runA, agentId, path: "src/pay" });
  await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runB, agentId, path: "docs" });
  const active = await svc.listActiveClaimsOnWorkspace(wsA, runA);
  expect(active.map((c) => c.path)).toEqual(["docs"]);
});

// releaseClaimsForRun: flips only that run's active claims
it("releases only the target run's active claims", async () => {
  await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runA, agentId, path: "src/pay" });
  await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runB, agentId, path: "docs" });
  expect(await svc.releaseClaimsForRun(runA)).toBe(1);
  const active = await svc.listActiveClaimsOnWorkspace(wsA);
  expect(active.map((c) => c.path)).toEqual(["docs"]);
});

// findExpiredClaims / expireClaim: only past-TTL active claims
it("finds and expires only past-TTL active claims", async () => {
  const past = new Date("2026-07-13T00:00:00.000Z");
  const c = await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runA, agentId, path: "src/pay", ttlMs: 1000, now: past });
  const later = new Date(past.getTime() + 5000);
  const expired = await svc.findExpiredClaims(later);
  expect(expired.map((e) => e.id)).toEqual([c.id]);
  await svc.expireClaim(c.id, later);
  expect(await svc.listActiveClaimsOnWorkspace(wsA)).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run workspace-path-claims-service`
Expected: FAIL — module not found (or SKIP if embedded Postgres unsupported — then rely on typecheck + route test).

- [ ] **Step 3: Create the service**

Create `server/src/services/workspace-path-claims.ts` with `workspacePathClaimService(db)`. Use `and, eq, ne, lte, isNotNull` from `drizzle-orm`; `workspacePathClaims` from `@paperclipai/db`; `normalizeClaimPath` from `./workspace-path-overlap.js`. Implement:
- `acquireClaim`: `now = input.now ?? new Date()`; insert `{ ...ids, path: normalizeClaimPath(input.path), status: "active", acquiredAt: now, expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_CLAIM_TTL_MS)) }`, `.returning()`, return row.
- `releaseClaimsForRun`: `update ... set status, releasedAt=now where heartbeatRunId=? and status='active'`, return affected count (`.returning()` length).
- `listActiveClaimsOnWorkspace`: `select ... where executionWorkspaceId=? and status='active' [and ne(heartbeatRunId, excludeRunId) when provided]`, order by `acquiredAt`.
- `findExpiredClaims`: `select id where status='active' and isNotNull(expiresAt) and lte(expiresAt, now)`.
- `expireClaim`: `update ... set status='expired', releasedAt=now where id=? and status='active'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run workspace-path-claims-service`
Expected: PASS (or SKIP).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/workspace-path-claims.ts server/src/__tests__/workspace-path-claims-service.test.ts
git commit -m "feat(workspace): path-claim service (acquire/release/list/expire)"
```

---

### Task 4: Reconciler TTL-expiry source

**Files:**
- Modify: `server/src/services/workspace-path-claims.ts` (add `makePathClaimExpirySource`)
- Modify: `server/src/index.ts` (register the source in the `runReconcile([...])` array at ~:899)
- Test: `server/src/__tests__/path-claim-expiry-source.test.ts`

**Interfaces:**
- Consumes: `ReconcileSource`, `ReconcileResult` from `./admission-reconciler.js`.
- Produces: `makePathClaimExpirySource(deps: { findExpiredClaims: (now: Date) => Promise<Array<{ id: string }>>; expireClaim: (id: string) => Promise<void> }): ReconcileSource` (name `"path-claim-expiry"`).

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/path-claim-expiry-source.test.ts` (pure, DI — no DB, mirror `admission-reconciler.test.ts` style):

```ts
import { describe, expect, it, vi } from "vitest";
import { makePathClaimExpirySource } from "../services/workspace-path-claims.js";

describe("makePathClaimExpirySource", () => {
  it("expires each past-TTL claim and reports repaired counts", async () => {
    const expireClaim = vi.fn().mockResolvedValue(undefined);
    const src = makePathClaimExpirySource({
      findExpiredClaims: async () => [{ id: "c1" }, { id: "c2" }],
      expireClaim,
    });
    const result = await src.reconcile(new Date("2026-07-13T00:00:00.000Z"));
    expect(src.name).toBe("path-claim-expiry");
    expect(result).toEqual({ source: "path-claim-expiry", drifted: 2, repaired: 2 });
    expect(expireClaim).toHaveBeenCalledTimes(2);
  });
  it("returns zero without throwing when nothing is expired", async () => {
    const src = makePathClaimExpirySource({ findExpiredClaims: async () => [], expireClaim: vi.fn() });
    expect(await src.reconcile(new Date())).toEqual({ source: "path-claim-expiry", drifted: 0, repaired: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run path-claim-expiry-source`
Expected: FAIL — `makePathClaimExpirySource` not exported.

- [ ] **Step 3: Add the source factory**

In `server/src/services/workspace-path-claims.ts`, add (mirroring `makeRunCapSweepSource` in `run-caps.ts:81`):

```ts
import type { ReconcileResult, ReconcileSource } from "./admission-reconciler.js";

export function makePathClaimExpirySource(deps: {
  findExpiredClaims: (now: Date) => Promise<Array<{ id: string }>>;
  expireClaim: (id: string) => Promise<void>;
}): ReconcileSource {
  return {
    name: "path-claim-expiry",
    async reconcile(now: Date): Promise<ReconcileResult> {
      const expired = await deps.findExpiredClaims(now);
      let repaired = 0;
      for (const { id } of expired) {
        await deps.expireClaim(id);
        repaired += 1;
      }
      return { source: "path-claim-expiry", drifted: expired.length, repaired };
    },
  };
}
```

- [ ] **Step 4: Register in the reconciler sweep**

In `server/src/index.ts`, inside the `runReconcile([ ... ])` array (~:899, after `makePanicHaltSweepSource({...})`), add:

```ts
          makePathClaimExpirySource({
            findExpiredClaims: (now) => workspacePathClaimService(db).findExpiredClaims(now),
            expireClaim: (id) => workspacePathClaimService(db).expireClaim(id),
          }),
```

Add the import at the top of `index.ts`: `import { workspacePathClaimService, makePathClaimExpirySource } from "./services/workspace-path-claims.js";` (match the existing service-import style).

- [ ] **Step 5: Run test + typecheck**

Run: `cd server && npx vitest run path-claim-expiry-source && npx tsc --noEmit`
Expected: PASS + exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/workspace-path-claims.ts server/src/index.ts server/src/__tests__/path-claim-expiry-source.test.ts
git commit -m "feat(workspace): reconciler TTL-expiry source for path claims"
```

---

### Task 5: Agent-JWT claim route (acquire + overlap audit + release)

**Files:**
- Create: `server/src/routes/workspace-path-claims.ts`
- Modify: `server/src/app.ts` (mount `api.use(workspacePathClaimRoutes(db))` near the other `api.use(...Routes(db))` at ~:239)
- Test: `server/src/__tests__/workspace-path-claims-routes.test.ts` (supertest, agent actor)

**Interfaces:**
- Consumes: `workspacePathClaimService` (Task 3), `detectClaimOverlap` (Task 1), `logActivity`, `req.actor.{agentId,companyId,runId}`.
- Produces: `workspacePathClaimRoutes(db): Router` with `POST /companies/:companyId/workspace-path-claims` and `POST /companies/:companyId/workspace-path-claims/release`.

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/workspace-path-claims-routes.test.ts` — model auth/harness on an existing agent-route test (e.g. `agent-permissions-routes.test.ts` or `approval-routes-idempotency.test.ts`); set `req.actor` to an agent with `{ agentId, companyId, runId }`. Seed a run whose `contextSnapshot.issueId` points at an issue with `executionWorkspaceId` = a `shared_workspace`. Assert:

```ts
// acquire returns 201 with the created claim; an overlapping active claim from ANOTHER run
// is reported in conflicts AND writes one workspace_path_claim_conflict audit row.
it("acquires a claim and reports + audits an overlapping peer claim", async () => {
  // seed: peer run runB with an active claim on "src/pay" in the same workspace
  const res = await request(app)
    .post(`/api/companies/${companyId}/workspace-path-claims`)
    .set(agentAuthHeaders(runSelf))
    .send({ path: "src/pay/api" });
  expect(res.status).toBe(201);
  expect(res.body.claim.path).toBe("src/pay/api");
  expect(res.body.conflicts.map((c) => c.heartbeatRunId)).toContain(runB);
  const audits = await db.select().from(activityLog).where(eq(activityLog.action, "workspace_path_claim_conflict"));
  expect(audits).toHaveLength(1);
});

// a run with no shared workspace ⇒ 400, no row written.
it("rejects a claim when the run has no shared workspace", async () => { /* seed isolated workspace ⇒ expect 400 */ });

// release flips the caller's active claims.
it("releases the caller's active claims", async () => { /* acquire then release ⇒ listActive empty for runSelf */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run workspace-path-claims-routes`
Expected: FAIL — route not mounted / 404. Confirm a genuine failure (fix harness until real RED).

- [ ] **Step 3: Create the route**

Create `server/src/routes/workspace-path-claims.ts` exporting `workspacePathClaimRoutes(db)`. For `POST /companies/:companyId/workspace-path-claims`:
1. `assertCompanyAccess(req, companyId)` (reuse the helper other routes use) and require `req.actor.type === "agent"` with a `runId`; else 403.
2. Load the run by `req.actor.runId`; verify `run.companyId === companyId && run.agentId === req.actor.agentId` (approvals.ts pattern); else 403.
3. Resolve the run's shared workspace: `issueId = readNonEmptyString(parseObject(run.contextSnapshot).issueId)`; load `issues.executionWorkspaceId` for it; load `execution_workspaces` → require `mode === "shared_workspace"`; else `res.status(400).json({ error: "path claims require a shared workspace" })`.
4. `const svc = workspacePathClaimService(db); const claim = await svc.acquireClaim({ companyId, executionWorkspaceId, heartbeatRunId: run.id, agentId: run.agentId, path: req.body.path ?? "", ttlMs: req.body.ttlMs })`.
5. `const others = await svc.listActiveClaimsOnWorkspace(executionWorkspaceId, run.id); const conflicts = detectClaimOverlap(claim.path, others, run.id);`
6. If `conflicts.length > 0`: `await logActivity(db, { companyId, actorType: "agent", actorId: run.agentId, agentId: run.agentId, runId: run.id, action: "workspace_path_claim_conflict", entityType: "execution_workspace", entityId: executionWorkspaceId, details: { path: claim.path, conflictingRunIds: conflicts.map((c) => c.heartbeatRunId) } });`
7. `res.status(201).json({ claim, conflicts });`

`POST .../release`: verify actor+run as above; `await svc.releaseClaimsForRun(run.id); res.status(200).json({ released: true });`.

- [ ] **Step 4: Mount the route**

In `server/src/app.ts`, near the other `api.use(...)` calls (~:239): `api.use(workspacePathClaimRoutes(db));` and add the import at the top matching the existing route-import style.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && npx vitest run workspace-path-claims-routes`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/workspace-path-claims.ts server/src/app.ts server/src/__tests__/workspace-path-claims-routes.test.ts
git commit -m "feat(routes): agent path-claim acquire/release with overlap audit"
```

---

### Task 6: Release claims on run end

**Files:**
- Modify: `server/src/services/heartbeat.ts` (add a `workspacePathClaimsSvc` instance + `releasePathClaimsForRun` helper; call it in the `executeRun` `finally` at ~:10765)
- Test: `server/src/__tests__/heartbeat-path-claim-release.test.ts` (embedded Postgres; or reuse the service test's harness to drive the release helper)

**Interfaces:**
- Consumes: `workspacePathClaimService` (Task 3).

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/heartbeat-path-claim-release.test.ts`. Prefer driving `executeRun` end-to-end (as slice-1's `heartbeat-workspace-conflict.test.ts` did) so a run with an active claim has it released when the run finishes; if that's impractical, assert the exported `releasePathClaimsForRun` helper flips the run's active claims to released. Assert: after the run ends, `listActiveClaimsOnWorkspace(ws)` for that run is empty and the claim row's status is `released`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run heartbeat-path-claim-release`
Expected: FAIL — claim still active after run end.

- [ ] **Step 3: Wire the release**

In `server/src/services/heartbeat.ts`: add `const workspacePathClaimsSvc = workspacePathClaimService(db);` near the other service instances (e.g. beside `workspaceOperationsSvc`), import `workspacePathClaimService` from `./workspace-path-claims.js`, and add a helper:

```ts
async function releasePathClaimsForRun(runId: string, runStatus: string | null | undefined) {
  const status = runStatus === "cancelled" ? "released" : runStatus === "failed" ? "failed" : "released";
  try {
    await workspacePathClaimsSvc.releaseClaimsForRun(runId, status);
  } catch (err) {
    logger.warn({ err, runId }, "path-claim release failed; reconciler TTL will reclaim");
  }
}
```

In the `executeRun` `finally` (heartbeat.ts:10765), after `releaseEnvironmentLeasesForRun({...})`:

```ts
          await releasePathClaimsForRun(run.id, latestRun?.status);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx vitest run heartbeat-path-claim-release`
Expected: PASS.

- [ ] **Step 5: Guard the run path (no regression)**

Run: `cd server && npx vitest run heartbeat-instance-admission heartbeat-workspace-conflict`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/heartbeat-path-claim-release.test.ts
git commit -m "feat(workspace): release path claims on run end"
```

---

### Task 7: `paperclip` skill instruction

**Files:**
- Modify: `skills/paperclip/references/issue-workspaces.md` (document the claim endpoint)

- [ ] **Step 1: Add the instruction**

Append a "Coordinating in a shared workspace (path claims)" section to `skills/paperclip/references/issue-workspaces.md` describing: when working in a shared workspace, before editing a subtree `POST /api/companies/{companyId}/workspace-path-claims` with `{ "path": "<subtree>" }` (auth via the local-agent token); the response includes `conflicts` — if non-empty, another agent is active on an overlapping path, so prefer a different subtree or coordinate; claims auto-release when the run ends. Emphasize it is advisory, not enforced. Keep it concise and consistent with the file's existing tone.

- [ ] **Step 2: Commit**

```bash
git add skills/paperclip/references/issue-workspaces.md
git commit -m "docs(skill): document workspace path-claim endpoint for agents"
```

---

### Task 8: Typecheck + suite gate

**Files:** none (verification task)

- [ ] **Step 1: Server typecheck** — `cd server && npx tsc --noEmit` → exit 0.
- [ ] **Step 2: Touched suites** — `cd server && npx vitest run "workspace-path-overlap" "workspace-path-claims" "path-claim-expiry-source" "heartbeat-path-claim-release"` → all PASS (embedded-PG suites may SKIP).
- [ ] **Step 3: Full workspace typecheck + migrations** — `pnpm -r typecheck` (repo root) → GREEN (includes `packages/db` `check:migrations`).
- [ ] **Step 4: Verify the branch** — `git log --oneline master..HEAD` → spec + 7 feature/doc commits, all green.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-13-workspace-path-claims-design.md`):
- Pure overlap module (spec §Arch 1) → Task 1.
- Table + migration (spec §Arch 2) → Task 2.
- Claim service (spec §Arch 3) → Task 3.
- Reconciler expiry source, first of its kind (spec §Arch 6, §decision 3) → Task 4.
- Agent-JWT route, advisory overlap audit + returned conflicts, 400 when no shared workspace (spec §Arch 4, §decisions 1/5) → Task 5.
- Run-end release (spec §Arch 5, §decision 3) → Task 6.
- Skill instruction (spec §Arch 7) → Task 7.
- Non-blocking (claim always created) → Task 5 Step 3 (overlap only audits/returns, never changes outcome).

**Placeholder scan:** Tasks 5 and 6 give the full route/helper logic and the asserted outcomes but leave the seed/harness boilerplate as "model on <named existing test>" (agent-actor setup, contextSnapshot seeding, embedded-PG plumbing) because that boilerplate must match the named harness exactly; the assertions (201 + claim + conflicts + one audit; 400 no-shared-workspace; released after run-end) are fully specified. Task 2's migration SQL is intentionally generated by drizzle-kit, not hand-written.

**Type consistency:** `normalizeClaimPath`/`pathsOverlap`/`detectClaimOverlap`/`ClaimLike` identical across Task 1 (def) and Tasks 3/5 (use). `workspacePathClaimService` method names (`acquireClaim`, `releaseClaimsForRun`, `listActiveClaimsOnWorkspace`, `findExpiredClaims`, `expireClaim`) identical across Tasks 3 (def), 4, 5, 6. `makePathClaimExpirySource` deps shape matches Task 3's `findExpiredClaims`/`expireClaim` signatures. Audit action `workspace_path_claim_conflict` + `entityType "execution_workspace"` identical in Task 5 (route) and its test.
