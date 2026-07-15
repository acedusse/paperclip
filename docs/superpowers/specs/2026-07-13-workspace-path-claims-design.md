# Design: Path-Level Soft-Claim Substrate (Combo 01, Phase 4B slice 2)

Second slice of [`042-workspace-conflict-coordination.md`](../../../.ideas/042-workspace-conflict-coordination.md),
building on the concurrent-shared-workspace *detection* slice (Phase 4B slice 1). This slice adds the
durable **claim** substrate: agents *declare* a subtree they're about to edit, overlapping claims are
*detected and audited*, and claims *expire* (run-end release + reconciler TTL sweep). It is
deliberately **non-blocking** — a claim is an advisory soft-lock, never a hard gate — and it does not
yet surface peers' claims into the agent prompt (that "tell the agent, coordinate" signal is the next
slice).

## Problem

Parallel agents sharing one `shared_workspace` tree can clobber each other's uncommitted edits. Slice
1 made the *risk condition* (concurrent occupancy) visible. But there is no way for an agent to
*declare* "I'm working on `src/payments`" so others can steer clear, and no primitive on which
coordination can be built. This slice adds that primitive: a per-run, per-path claim with a
lifecycle, plus overlap detection — the foundation the coordination and (optional, later) enforcement
slices consume.

## Substrate reality (from exploration)

The idea assumes pieces that don't exist; this design builds them honestly:
- **No TTL-expiry reclamation exists anywhere.** `environment_leases.expiresAt` is defined but nothing
  sweeps it; the reconciler explicitly reserves "Phase 4 (leases)". This slice builds the **first**
  expiry reconciler source.
- **No native agent tool/function surface.** Adapters are CLI subprocesses. An agent "claims a path"
  by calling an **authenticated HTTP route** (local-agent JWT → `req.actor.{agentId,companyId,runId}`,
  as `routes/approvals.ts:92-105` does) via the `paperclip` skill — it depends on agent cooperation,
  not a guaranteed tool call.
- **No path/subtree scope is recorded** for any run/issue, and a shared tree's `git status` is an
  unattributable union. So path-accurate claims can *only* come from the agent declaring them.

Reused as-is: the `environment_leases` CRUD shape (mirrored in a new table), the `executeRun`
`finally` release hook (heartbeat.ts:10765, beside `releaseEnvironmentLeasesForRun`), the
runtime-API/JWT callback channel, and the `ReconcileSource`/`runReconcile` extension point
(index.ts:899).

## Scope

**In**
- New `workspace_path_claims` table (migration) + Drizzle schema.
- A pure path-overlap module (normalize + subtree-prefix overlap + conflict detection).
- A claim service: acquire, release-for-run, list-active-on-workspace, find-expired, expire.
- An authenticated HTTP route the agent calls to acquire/release a claim; on acquire it detects
  overlap with other runs' active claims, audits conflicts, and returns them in the response.
- Release-on-run-end wired into the `executeRun` `finally`.
- The first reconciler TTL-expiry source, registered in the periodic sweep.
- A `paperclip` skill instruction documenting the claim/release endpoint.

**Out (later 042 slices)**
- Injecting peers' active claims into the agent prompt (the advisory "these paths are claimed"
  signal + per-adapter rendering).
- Any blocking/enforcement (claims stay advisory; overlap never prevents a claim or an edit).
- Factoring claim contention into admission/selection (don't wake an agent whose only work is
  claimed).
- Git-derived automatic claims / ownership zones.

**Not built (reused)**
- `environment_leases` schema shape, the `finally` release site, the runtime-API JWT channel,
  `ReconcileSource`/`runReconcile` + index.ts registration, `logActivity`.

## Design decisions (locked)

1. **Claims are advisory soft-locks — never blocking.** Acquiring a claim that overlaps another run's
   active claim **succeeds**; the overlap is recorded (audit) and **returned to the caller** so the
   claiming agent learns of it immediately. Nothing prevents the claim or any file edit. This is idea
   042's "coordinate, don't just block" principle, and it keeps autonomous agents from deadlocking.

2. **No DB unique constraint on `(workspaceId, path)`.** Mirroring `environment_leases`, overlaps are
   *allowed and detected*, not DB-enforced. A unique constraint would turn a soft-lock into a hard
   one and could wedge agents.

3. **Two reclamation paths, both required.** (a) **Run-end release** in the `executeRun` `finally`
   (covers success/failure/cancel) marks the run's active claims released. (b) **Reconciler TTL
   expiry** marks claims past `expiresAt` expired — this is the crash-safety net so a run that dies
   without hitting `finally` never wedges a path forever. `expiresAt` is Paperclip-computed
   (`acquiredAt + ttl`), since no existing TTL substrate does this.

4. **Path model: normalized POSIX relative subtree, prefix-overlap.** A claim's `path` is normalized
   (POSIX separators, no leading/trailing slash, no `.`/empty). Two claims overlap iff one path
   equals the other or is an ancestor prefix of the other (segment-aware, so `src/pay` does not
   overlap `src/payments`). An empty/normalized-to-root path claims the whole workspace.

5. **Identity from the local-agent JWT.** The claim route reads `req.actor.{agentId, companyId,
   runId}` and loads the run to resolve its execution workspace (via the run→workspace link), exactly
   as `routes/approvals.ts` verifies an agent-run actor. A claim without a resolvable shared workspace
   is rejected (400) — claims only make sense in a shared tree.

6. **The pure overlap logic is unit-tested; the DB/route/reconciler layers wrap it.** Normalize +
   overlap + conflict-set are pure functions verified without a database.

## Architecture

### 1. Pure overlap module — `server/src/services/workspace-path-overlap.ts` (new)

```ts
export function normalizeClaimPath(path: string): string;              // POSIX, trim slashes, collapse
export function pathsOverlap(a: string, b: string): boolean;           // equal or ancestor-prefix (segment-aware)
export interface ClaimLike { path: string; heartbeatRunId: string | null; }
export function detectClaimOverlap(newPath: string, existing: ClaimLike[]): ClaimLike[]; // conflicting claims
```

### 2. Table + schema — `packages/db/src/schema/workspace_path_claims.ts` (new) + migration

Mirrors `environment_leases`:

```
id, companyId(cascade), executionWorkspaceId(cascade), heartbeatRunId(set null), agentId(set null),
path text notNull, status text notNull default 'active', acquiredAt, expiresAt (nullable), releasedAt,
metadata jsonb, createdAt, updatedAt
indexes: (companyId, executionWorkspaceId, status); heartbeatRunId; (companyId, expiresAt)
```

Migration generated via `pnpm --filter @paperclipai/db generate` (drizzle-kit; auto-journals — no
hand-editing the journal).

### 3. Claim service — `server/src/services/workspace-path-claims.ts` (new)

```ts
acquireClaim(input: { companyId; executionWorkspaceId; heartbeatRunId; agentId; path; ttlMs }): Promise<Claim>
releaseClaimsForRun(heartbeatRunId: string, status?: "released"|"expired"|"failed"): Promise<number>
listActiveClaimsOnWorkspace(executionWorkspaceId: string, excludeRunId?: string): Promise<Claim[]>
findExpiredClaims(now: Date): Promise<Array<{ id: string }>>
expireClaim(id: string): Promise<void>
```

`acquireClaim` inserts `status:'active'`, `acquiredAt=now`, `expiresAt=now+ttlMs` (default TTL, e.g.
30 min). Path is normalized before insert.

### 4. HTTP route — `server/src/routes/workspace-path-claims.ts` (new)

- `POST /companies/:companyId/workspace-path-claims` — body `{ path, ttlMs? }`; agent-JWT auth. Loads
  the run (`req.actor.runId`), verifies it belongs to the actor's agent+company (approvals.ts
  pattern), resolves its shared execution workspace, `acquireClaim`, then
  `detectClaimOverlap(path, listActiveClaimsOnWorkspace(ws, excludeRunId=runId))`. On conflicts:
  `logActivity(action:"workspace_path_claim_conflict", entityType:"execution_workspace", details:{
  path, conflictingRunIds })`. Returns `{ claim, conflicts }` (201). Overlap never changes the
  outcome — the claim is always created.
- `POST /companies/:companyId/workspace-path-claims/release` (or `DELETE /:id`) — releases the
  caller's claim(s). Best-effort.
- Registered where the other agent-facing routes are mounted.

### 5. Run-end release — `server/src/services/heartbeat.ts`

In the `executeRun` `finally` (heartbeat.ts:10765), beside `releaseEnvironmentLeasesForRun`:

```ts
await releasePathClaimsForRun(run.id, latestRun?.status).catch(() => undefined);
```

where `releasePathClaimsForRun` maps run status → claim status and calls
`workspacePathClaimsSvc.releaseClaimsForRun`. Best-effort (swallow) — release failure must not break
run teardown.

### 6. Reconciler TTL-expiry source — `server/src/services/workspace-path-claims.ts` (factory) + `index.ts`

Mirroring `makeRunCapSweepSource` (run-caps.ts:81):

```ts
export function makePathClaimExpirySource(deps: {
  findExpiredClaims: (now: Date) => Promise<Array<{ id: string }>>;
  expireClaim: (id: string) => Promise<void>;
}): ReconcileSource; // name: "path-claim-expiry"; reconcile finds expired active claims, expires each, returns counts
```

Registered in the `runReconcile([...])` array at `server/src/index.ts:899`, alongside the run-cap /
panic-halt sources.

### 7. `paperclip` skill instruction — `skills/paperclip/references/issue-workspaces.md` (or api-reference.md)

Document: in a shared workspace, before editing a subtree, `POST .../workspace-path-claims` with the
subtree path; honor returned `conflicts` (another agent is working there — prefer a different subtree
or coordinate); claims auto-release at run end. Advisory, not enforced.

## Data flow

```
agent mid-run (shared workspace) ──POST /workspace-path-claims { path }──▶ route (agent-JWT: agentId,runId,companyId)
   │  load run, resolve shared executionWorkspaceId
   ▼
acquireClaim(...) [status active, expiresAt=now+ttl]  +  detectClaimOverlap(path, listActive(ws, exclude=run))
   │                                                         └─ conflicts ─▶ logActivity(workspace_path_claim_conflict)
   ▼
201 { claim, conflicts }   (claim ALWAYS created; conflicts advisory)

run ends ──executeRun finally──▶ releasePathClaimsForRun(runId)         [active → released]
periodic sweep ──runReconcile──▶ path-claim-expiry: findExpiredClaims(now) → expireClaim   [active & past TTL → expired]
```

## Error handling

- **Overlap on acquire:** not an error — claim created, conflicts audited + returned.
- **No resolvable shared workspace for the run:** route returns 400 (claims are only meaningful in a
  shared tree); no row written.
- **Run-end release failure:** swallowed; the reconciler TTL sweep is the backstop.
- **Reconciler source throw:** isolated by `runReconcile`'s fault-tolerant fold (never blocks other
  sources).
- **Crashed run (never hits `finally`):** its claims expire at TTL via the reconciler.

## Testing

- **Pure** (`workspace-path-overlap.test.ts`): `normalizeClaimPath` (slashes, `.`, backslashes,
  empty→root); `pathsOverlap` (equal; ancestor both directions; sibling non-overlap `src/pay` vs
  `src/payments`; root overlaps everything); `detectClaimOverlap` returns exactly the conflicting
  entries, excluding same-run.
- **Service** (embedded PG): acquire sets active + `expiresAt`; `releaseClaimsForRun` flips only that
  run's active claims; `listActiveClaimsOnWorkspace` excludes released/expired and the excluded run;
  `findExpiredClaims`/`expireClaim` select and flip past-TTL active claims only.
- **Route** (supertest + agent JWT / mocked actor): acquire returns 201 with the claim; an
  overlapping active claim from another run appears in `conflicts` and writes one
  `workspace_path_claim_conflict` audit; a claim on a run with no shared workspace → 400; release
  flips the caller's claims.
- **Reconciler** (`makePathClaimExpirySource`): given expired claims, `reconcile` expires each and
  reports `repaired`; nothing-to-do returns zero without throwing.
- **Run-end release**: driving `executeRun` (or the `releasePathClaimsForRun` helper) releases the
  run's active claims in the `finally`.

## Exit criteria

- An agent in a shared workspace can `POST` a subtree claim and gets `201 { claim, conflicts }`; an
  overlapping claim from another active run is reported in `conflicts` and audited, but the claim is
  still created (never blocked).
- A run's active claims are released when it ends (any outcome), and a crashed run's claims expire at
  TTL via the reconciler — no path is wedged permanently.
- No existing admission/run behavior changes; the reconciler gains one fault-isolated source.
- The migration is generated + journaled via the standard flow; `check:migrations` passes.
