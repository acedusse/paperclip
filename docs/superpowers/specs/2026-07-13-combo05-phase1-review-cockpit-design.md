# Combo-05 Phase 1 — Review cockpit legibility + triage (design)

**Date:** 2026-07-13
**Status:** Approved design, pre-implementation
**Parent plan:** `.ideas/combinations/combo-05-phasing-corrected.md` (Phase 1)
**Scope decision:** build the four Phase-1 shared seams (risk model, changeset/diff surface,
authority resolver, delivery pipeline, decision audit) seeded minimally, and deliver the two
operator-facing surfaces — the per-run diff surface (017) and the risk-sorted, groupable triage
inbox (016). No auto-decisions, no new delivery channels.

## Goal

Make every approval **legible** (a concrete PR-style diff of what its run did) and **triageable**
(risk-sorted, grouped, bulk-actionable), while routing every decision through a single authority
resolver and a single audit path — so Phases 2–4 (auto-approve, digest, push, delegation,
stakeholder page) plug into these seams instead of reimplementing them.

The slice must be a **no-op for existing single-item approval behavior** (approve/reject/request-
revision keep working identically, just routed through the resolver) and must **never expose a
decision method other than `explicit_human`**.

## In scope

1. **Risk model** — `riskScore(approval, ctx)` pure function + pluggable signal registry, seeded
   with four signals. Persisted `approval_risk` snapshot per approval.
2. **Changeset capture + diff surface (017)** — run-finalize hook computing `git diff
   <baseRef>...HEAD` (+ untracked), persisted to `run_changesets`; read path + React diff view.
3. **Authority resolver** — `canDecide(approval, actor, method)`, seeded with one writer
   (`explicit_human`) and the above-band hard rule.
4. **Delivery pipeline** — channel interface + `inbox` channel only.
5. **Decision audit** — `recordDecision()` on every resolve, wired into `activity-log.ts`.
6. **Triage inbox (016)** — `GET …/approvals/triage` (risk-sorted + server-computed groups) and
   bulk approve/reject/request-changes over a group.

## Explicitly out of scope (later phases, plugging into these seams)

Auto-approve policies (P2); narration engine + scheduled digest (P2); web push / PWA / per-user
delivery prefs (P3); delegation, coverage/SLA routing, bounded agent-approver (P4); stakeholder
transparency page (P4); run-to-run changeset comparison and AI change summary (later). The
`webpush`/`email` channels and the non-`explicit_human` resolver writers are stubbed registration
points only.

## Architecture & components

### 1. Risk model — `server/src/services/approval-risk.ts` (new)

```ts
type RiskSignal = {
  name: string;
  // pure; returns 0..1 contribution + human-readable reason, or null = "no opinion"
  evaluate(ctx: RiskContext): { weight: number; reason: string } | null;
};

type RiskBand = "low" | "medium" | "high" | "critical";

riskScore(ctx: RiskContext): { score: number; band: RiskBand; reasons: string[] };
```

Seeded signals (each derives only from data already present):
- **trust stage** — acting agent's trust/probation stage (idea 009 surface; if absent, treat as
  lowest trust → higher risk).
- **implied spend** — spend the action implies (payload budget deltas; run cost from `costs.ts`).
- **sensitive-boundary flags** — payload touches secrets, external send, or budget change.
- **changeset diff size** — total ±lines / files touched from the run's `run_changesets` row.

Bands are threshold cuts over `score`, thresholds in one config constant. The **above-band hard
rule** references a single configurable `autoDecisionMaxBand` (default `low`).

`approval_risk` snapshot persisted on approval create and recomputed when the changeset lands
(diff size is a signal). Stored so inbox order is stable and the audit shows the score at decision
time.

### 2. Changeset capture — `server/src/services/run-changeset.ts` (new)

Run-finalize hook (where a heartbeat run completes and the workspace is still present):

```
captureRunChangeset(runId):
  resolve executionWorkspace (cwd/providerRef, baseRef)
  repoRoot = git rev-parse --show-toplevel      // reuse runGit() from execution-workspaces.ts
  files    = parse `git diff --numstat -M <baseRef>...HEAD`   // adds/mods/dels/renames, ±lines, binary
           + `git status --porcelain=v1 --untracked-files=all`  // uncommitted / untracked
  for each text file under size cap: store unified diff blob (diffRef)
  for binary / over-cap: store metadata only (path, status, bytes) — no inline diff
  commands = workspace_operations rows for runId (command, exitCode, status)
  persist run_changesets { runId, companyId, files[], commands[], summaryStats, capturedAt }
```

Reuses the existing `runGit(args, cwd)` helper and porcelain parsing already in
`execution-workspaces.ts`. Capture is best-effort: on git failure, persist a changeset with a
`warning` and empty `files[]` (never block run finalize). Diff blobs stored via the existing
file-resource/blob path; large/binary handled as metadata + download (mirrors `file-resources.ts`).

### 3. Authority resolver — `server/src/services/approval-authority.ts` (new)

```ts
type DecisionMethod =
  | "explicit_human"      // P1
  | "delegated_human"     // P4
  | "coverage_escalation" // P4
  | "bounded_agent"       // P4
  | "auto_policy";        // P2

// lower precedence index = higher authority
const METHOD_PRECEDENCE = ["explicit_human", "delegated_human",
  "coverage_escalation", "bounded_agent", "auto_policy"] as const;

canDecide(approval, actor, method): { allow: boolean; deny?: string };
```

Phase 1 registers only `explicit_human`. Rules:
- unknown/unregistered method → deny.
- `method !== "explicit_human"` → deny (nothing else is registered yet).
- **above-band hard rule:** if `approval.risk.band` outranks `autoDecisionMaxBand` and `method` is
  any non-human method (`auto_policy`, `bounded_agent`), deny — asserted by test now so later
  writers cannot bypass it.

Every existing resolve path (`approve`/`reject`/`requestRevision` in `approvals.ts` and
`issue-approvals.ts`) calls `canDecide(...,"explicit_human")` before mutating; a deny surfaces as
`unprocessable`. Behavior is unchanged for humans — the gate always allows explicit human decisions
at/under band.

### 4. Delivery pipeline — `server/src/services/notification-delivery.ts` (new)

```ts
type DeliveryChannel = {
  name: "inbox" | "webpush" | "email";
  deliver(target: DeliveryTarget, payload: NotificationPayload): Promise<void>;
};
registerChannel(channel); getChannels();
```

Phase 1 registers only `inbox`, which wraps today's sidebar-badge / inbox signal — no behavior
change, just the seam. `webpush`/`email` are registration points for P3.

### 5. Decision audit — extend `activity-log.ts`

```ts
recordDecision({ approvalId, companyId, actor, method, outcome, riskSnapshot, note }): void
```

Writes one activity-log entry per decision. Bulk actions (below) call it once per item. The record
carries the risk band/score at decision time and the method, so the P4 tamper-evident log (idea
023) can later swap in behind the same call.

### 6. Triage inbox — `server/src/routes/approvals.ts` (extend) + service

- `GET /companies/:id/approvals/triage` → pending/revision approvals joined with their
  `approval_risk` snapshot and (when the approval references a run) a changeset summary, **sorted by
  risk desc**, plus server-computed `groups[]` keyed by `{agentId, issueSubtreeRoot, type}`.
- `POST /companies/:id/approvals/bulk` `{ ids[], action: approve|reject|request_changes, note? }`
  → for each id: `canDecide(...,"explicit_human")` → resolve via existing service → `recordDecision`.
  Partial success reported per-id (some may have been decided concurrently).

### 7. UI — `ui/` triage inbox + diff view

- Triage inbox list: risk-band chips, group headers ("all 8 doc edits — marketing"), keyboard
  bulk-select + approve/reject/request-changes, per-item inline diff (component below).
- `RunChangesetView` React component: file tree (add/mod/del/rename icons, ±lines), unified diff
  per text file, metadata + download for binary/large. Reused by the P3 push card.

## Data model (new tables)

`run_changesets` — `id`, `companyId`, `heartbeatRunId` (unique), `files jsonb`
(`{path,status,additions,deletions,binary,diffRef}[]`), `commands jsonb`
(`{command,exitCode,status}[]`), `summaryStats jsonb`, `warning text?`, `capturedAt`.

`approval_risk` — `approvalId` (pk/fk), `companyId`, `score int`, `band text`, `reasons jsonb`,
`computedAt`. (Or equivalent columns on `approvals`; a side table keeps the hot `approvals` row
lean and lets the snapshot be recomputed without racing decision writes.)

## Error handling

- Changeset capture never blocks run finalize; git failure → persisted `warning`, empty `files[]`.
- Missing/cleaned workspace at review time → serve the **persisted** changeset (the whole point of
  capturing at finalize); if none was captured, the diff view shows "no changeset recorded".
- Resolver deny → `unprocessable` with the deny reason; bulk action reports it per-id, others proceed.
- Risk recompute failure → keep the last snapshot; never leave an approval unsortable.

## Testing

- **Risk model:** determinism (same ctx → same score), band thresholds, `reasons[]` content;
  precedence of `METHOD_PRECEDENCE` asserted by a locked test.
- **Authority resolver:** allows `explicit_human` at/under band; denies every other method; denies
  a non-human method on an above-band item (guards the hard rule before any such method exists).
- **Changeset capture:** fixture git worktree exercising add / modify / delete / rename / binary /
  untracked; verify numstat + porcelain parsing and large/binary → metadata-only; git failure →
  warning + empty files, run finalize still succeeds; **changeset readable after workspace cleanup**.
- **Triage:** risk-desc sort; grouping by {agent, issue subtree, type}; bulk action resolves every
  id and writes exactly one audit record each; concurrent double-decide reported as per-id partial.
- **No-op guarantee:** single-item approve/reject/request-revision behavior unchanged end-to-end.

## Verification

Drive the real flow: create an approval tied to a completed run, confirm the persisted diff renders
after the workspace is cleaned up, triage-sort a mixed-risk inbox, bulk-approve a group, and confirm
one audit record per item and that a stub above-band non-human decision is refused.
