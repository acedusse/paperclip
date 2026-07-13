# Design: WIP Limits & Flow Control — Observability First (Combo 01, Phase 4A-ii)

Companion to [`combo-01-phasing-corrected.md`](../../../.ideas/combinations/combo-01-phasing-corrected.md)
(Track 4A) and idea [`061-wip-limits-flow-control.md`](../../../.ideas/061-wip-limits-flow-control.md).
This is the first, lowest-risk slice of 061: **per-agent WIP visibility + flow metrics, no gate.**
It follows 4A-i (adaptive heartbeat cadence) and deliberately mirrors that slice's layering.

## Problem

Paperclip caps **compute** concurrency (per-agent `maxConcurrentRuns`, the fleet governor / idea
001) but has no concept of **work-in-progress (WIP)** — how many issues an agent has *actively in
progress* at once. These are different levers: concurrency governs how much *machine* runs at once;
WIP governs how much *work* is open at once. Without any WIP signal, autonomous agents can start far
more than they finish — half-done issues pile up, cycle time balloons, and a board looks busy while
little ships. Today there is not even a *readout* of an agent's in-progress load or its flow numbers,
so an operator can't see the problem, let alone tune it.

This slice makes the problem **visible and configurable** before it makes it *enforced*: per-agent
WIP limit config, a live in-progress count, an over-limit warning, and the two flow numbers that
matter (cycle time, throughput) — all surfaced per agent. Enforcement (steering a maxed-out agent to
finish rather than start) is a later slice; see **Out**.

## Scope

**In**
- Per-agent WIP limit **config** (`enabled`, `maxInProgress`), opt-in, stored under
  `runtimeConfig.heartbeat.wipLimit`.
- Live **in-progress count** per agent (issues where `status = "in_progress"` and the agent is the
  current assignee).
- **Over-limit warning** — a soft signal only: the API reports `overLimit`/`overBy` and the UI styles
  the readout as a warning. Nothing is blocked, deferred, or re-selected.
- **Flow metrics** computed on read: `throughputLast7d` (issues completed in the trailing 7 days) and
  `medianCycleTimeMs` (median of `completedAt − startedAt` over those completed issues).
- Read-only per-agent **readout** (`WIP 4 / 3 ⚠ · 3/wk · ~2h`) beside the existing cadence readout,
  plus config controls in the agent form.

**Out (deferred to later 061 slices)**
- **Enforcement / gating.** Refining the pull point (`startNextQueuedRunForAgent`,
  `heartbeat.ts:8634`) so a maxed-out agent is steered to finish rather than start. This slice does
  **not** touch run selection or the checkout flip.
- Team-level and workflow-stage (status-column) WIP limits.
- Start/finish-ratio "thrash" alarms and chronic-at-limit detection.
- Historical time-series / rollup tables and charts (metrics are computed on read, not persisted).
- Feeding WIP into the assignment/admission path (ideas 001 / 025).
- Instance-level default WIP toggle.

**Not built (already exists)**
- The counting substrate. `issues` carries `status`, `assigneeAgentId`, and the composite index
  `issues_company_assignee_status_idx (company_id, assignee_agent_id, status)`
  (`packages/db/src/schema/issues.ts:89`) — the in-progress count is a direct indexed query.
- The flow-metric substrate. `issues.startedAt` / `completedAt` / `cancelledAt`
  (`issues.ts:80-82`) are auto-stamped on status change, so cycle time and throughput need **no new
  table and no status-history mining**.
- Config plumbing. `runtimeConfig` is existing JSONB (`agents.ts:42`); WIP config rides alongside
  `idleBackoff` under `runtimeConfig.heartbeat`. **No DB migration is required for this slice.**

## Design decisions (locked)

1. **Observability before enforcement.** This slice ships the *signal* (count, over-limit flag,
   flow numbers) and the *config*, but no gate. In the autonomous heartbeat loop there is no human to
   "steer," so a real gate means deferring run claims — a behavioral change deferred to its own slice
   once the numbers are trusted. The over-limit state is a warning, nothing more.

2. **Opt-in, no behavior change by default.** `wipLimit.enabled` defaults `false`; existing agents
   read exactly as before. When disabled, `limit` is `null` and `overLimit` is always `false` — the
   count and flow metrics are still computed and shown (they're free observability), but there is no
   limit to be over.

3. **"In progress" = `status === "in_progress"` only.** The checkout-flip state (`issues.ts:5438`).
   `in_review` is intentionally excluded for the first cut — it's a different flow stage and folding
   it in is a scope decision better made once the base numbers are visible.

4. **Metrics computed on read, list-safe.** No background job, no rollup table. The agents **list**
   endpoint computes counts and flow metrics with **two grouped queries per request** (one
   `GROUP BY assignee_agent_id` count of in-progress issues; one grouped fetch of
   `{startedAt, completedAt}` for issues completed in the trailing 7 days) — **not** two queries per
   agent. Both use the existing composite index.

5. **The math lives in a pure module.** All aggregation (`wipStatus`, `computeFlowMetrics`) is pure
   and DB-free, mirroring `heartbeat-cadence.ts`; the service/route layer fetches rows and hands them
   in. This keeps the logic unit-testable without a database.

6. **Accepted approximations (explicit).**
   - Throughput and cycle time attribute an issue to its **current** `assigneeAgentId`. Reassignment
     history isn't tracked, so a completed issue counts toward whoever holds it at read time. This is
     the same attribution the count uses and is acceptable for a per-agent readout.
   - The flow window is a **fixed 7 days**, not operator-configurable, in this slice.
   - `medianCycleTimeMs` is `null` when the agent has completed no issues in the window (rendered as
     `—`), distinguishing "no data" from "zero."

## Architecture

Five layers, each mirroring the corresponding 4A-i layer so the change is idiomatic:

### 1. Config schema (shared validator)
`packages/shared/src/validators/agent-heartbeat.ts`, a sibling to `idleBackoffSchema`:

```ts
/**
 * Combo-01 Phase 4A-ii per-agent WIP limit, stored under
 * `runtimeConfig.heartbeat.wipLimit`. Disabled by default so existing agents
 * keep unbounded in-progress behavior until an operator opts in. This slice
 * surfaces the limit as a warning only — nothing is gated on it yet.
 */
export const wipLimitSchema = z.object({
  enabled: z.boolean().default(false),
  maxInProgress: z.number().int().positive().default(3),
});
export type WipLimitConfig = z.infer<typeof wipLimitSchema>;
```

### 2. Pure module (no DB)
New `server/src/services/wip-flow.ts`, analogous to `heartbeat-cadence.ts`:

- `parseWipLimitConfig(runtimeConfig): WipLimitConfig` — reads `runtimeConfig.heartbeat.wipLimit`,
  parses via `wipLimitSchema` (mirrors `parseHeartbeatCadenceConfig`).
- `wipStatus(current: number, cfg: WipLimitConfig): WipStatus` where
  `WipStatus = { limit: number | null; current: number; overBy: number; overLimit: boolean }`.
  Disabled → `{ limit: null, current, overBy: 0, overLimit: false }`.
  Enabled → `overBy = max(0, current − maxInProgress)`, `overLimit = overBy > 0`.
- `computeFlowMetrics(rows, nowMs): FlowMetrics` where each row is `{ startedAt, completedAt }` and
  `FlowMetrics = { throughputLast7d: number; medianCycleTimeMs: number | null; sampleSize: number }`.
  The caller pre-filters rows to the trailing-7-day window; the function counts them, derives
  per-issue cycle time from `completedAt − startedAt` (skipping rows without a `startedAt`), and
  returns the median (`null` on an empty set).

### 3. DB query helpers (service)
Alongside `countRunningRunsForAgent` (`heartbeat.ts:7281`) — but querying `issues`, not
`heartbeatRuns`:

- **Grouped in-progress counts for a company:**
  `SELECT assignee_agent_id, count(*) FROM issues WHERE company_id = ? AND status = 'in_progress'
   AND assignee_agent_id IS NOT NULL GROUP BY assignee_agent_id` → `Map<agentId, number>`.
- **Grouped recent completions for a company:**
  `SELECT assignee_agent_id, started_at, completed_at FROM issues WHERE company_id = ?
   AND completed_at >= now() − interval '7 days' AND assignee_agent_id IS NOT NULL` → rows grouped
  by agent for `computeFlowMetrics`.

A single-agent read reuses the same helpers filtered to one agent (or reads its bucket from the
grouped result).

### 4. Routes exposure
`server/src/routes/agents.ts`, attached exactly like `effectiveHeartbeatIntervalSec` (:585-586).
Each agent read/list entry gains:

```ts
wip:  { limit: number | null, current: number, overBy: number, overLimit: boolean },
flow: { throughputLast7d: number, medianCycleTimeMs: number | null },
```

The list handler runs the two grouped queries once and distributes results across agents.

### 5. UI
- New `ui/src/components/AgentWipReadout.tsx` (mirrors `AgentCadenceReadout.tsx`): renders
  `WIP {current} / {limit}` with warning styling when `overLimit`, or `WIP {current}` when the limit
  is `null`; appends `{throughputLast7d}/wk` and cycle time via `formatDurationMs` (`—` when null).
- `ui/src/components/AgentConfigForm.tsx`: WIP enable-toggle + `maxInProgress` number input in the
  existing Phase-4A block, reading/writing `runtimeConfig.heartbeat.wipLimit` (with the same
  override-overlay treatment idle-backoff uses).
- `ui/src/pages/Agents.tsx`: derive readout props from the API `wip`/`flow` fields and render
  `AgentWipReadout` beside `AgentCadenceReadout` (:529).

## Data flow

```
issues table (status, assigneeAgentId, startedAt, completedAt)
   │  two grouped queries (count in_progress · recent completions)  [routes/agents.ts]
   ▼
service query helpers ──rows──► wip-flow.ts (pure: wipStatus, computeFlowMetrics)
   │                                   │
   │ parseWipLimitConfig(runtimeConfig)│
   ▼                                   ▼
agent read/list response { wip, flow } ──► Agents.tsx ──► AgentWipReadout
                                       └─► AgentConfigForm (edit wipLimit)
```

Config write path: `AgentConfigForm` → agent update route → `runtimeConfig.heartbeat.wipLimit`,
normalized on write by the same `routes/agents.ts` normalizers that handle `idleBackoff`
(`normalizeNewAgentRuntimeConfig`, :1038).

## Error handling

- **Disabled / absent config:** `parseWipLimitConfig` returns schema defaults (`enabled: false`);
  count and flow metrics still render, `overLimit` is always `false`.
- **Malformed `runtimeConfig.heartbeat.wipLimit`:** `wipLimitSchema.parse` throws on write (rejected
  like any invalid agent update); on read, parsing falls back to defaults so a bad blob degrades to
  "disabled + observability" rather than failing the agent read.
- **No completed issues in window:** `medianCycleTimeMs: null`, `throughputLast7d: 0` — rendered as
  `—` and `0/wk`, never a divide-by-zero.
- **Metric query failure:** the read must not fail the whole agent response. Flow metrics are
  best-effort — on query error the handler logs and returns `flow: { throughputLast7d: 0,
  medianCycleTimeMs: null }` (observability degrades gracefully; the agent list still loads).

## Testing

Mirrors the 4A-i test layering:

- **Schema** (`agent-heartbeat.test.ts`): `wipLimitSchema` defaults (`enabled:false`,
  `maxInProgress:3`), rejects `maxInProgress` ≤ 0 and non-integers.
- **Pure module** (`wip-flow.test.ts`): `wipStatus` for disabled / under / at / over limit
  (`overBy`/`overLimit` correctness); `computeFlowMetrics` for empty set (`null` median, `0`
  throughput), single issue, odd/even-count median, and rows missing `startedAt`.
- **Routes** (`agents-wip-read.test.ts`, `agents-wip-list.test.ts`): read and list return correct
  `wip`/`flow`; the list path issues the two grouped queries and attributes counts to the right
  agents (guards against N+1 regressions and mis-bucketing).
- **UI** (`AgentWipReadout.test.tsx` + a config-form test): warning styling when over limit, plain
  render when under / unlimited, `—` for null cycle time, and that toggling the config control emits
  the `runtimeConfig.heartbeat.wipLimit` patch.

## Exit criteria

- An agent with `wipLimit.enabled` and 4 `in_progress` issues against a limit of 3 shows
  `WIP 4 / 3 ⚠` (over-limit warning) in the UI and `overLimit: true, overBy: 1` in the API; no run is
  blocked, deferred, or re-selected.
- An agent with `enabled:false` shows its live count and flow numbers with no limit and never
  `overLimit`.
- Cycle time and throughput reflect the agent's issues completed in the trailing 7 days; an agent
  with no recent completions shows `—` / `0/wk`.
- The agents **list** endpoint computes all agents' WIP and flow with two grouped queries, not two
  per agent.
