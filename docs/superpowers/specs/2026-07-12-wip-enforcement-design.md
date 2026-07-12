# Design: WIP Enforcement — the Pull-Gate (Combo 01, Phase 4A-ii enforcement)

Follow-on to [`2026-07-12-wip-limits-flow-control-design.md`](2026-07-12-wip-limits-flow-control-design.md)
(the observability slice) and idea [`061-wip-limits-flow-control.md`](../../../.ideas/061-wip-limits-flow-control.md).
The observability slice shipped the WIP *config*, *count*, *warning*, and *flow metrics* but **no gate**.
This slice adds the gate: a maxed-out agent is steered to **finish before starting**.

## Problem

The observability slice makes an agent's over-WIP state *visible* but does nothing about it —
autonomous agents keep starting new issues past their configured limit, which is exactly the
"start far more than they finish" pathology idea 061 exists to stop. WIP limits are only a
flow-control discipline if they actually gate the *start* of new work. This slice enforces the limit
at the one point where new work begins, while never touching work already in progress ("stop
starting, start finishing").

## Scope

**In**
- **Gate new-issue starts** at the run-selection choke point when an agent is at/over its WIP limit.
  A run that would flip an issue `todo/backlog/blocked → in_progress` (a *new start*) is deferred
  when there's no WIP headroom; a run that *continues* an already-`in_progress` issue is never
  gated.
- **Budgeted, not binary.** Per admission sweep, the agent may start up to
  `max(0, wipLimit − currentInProgress)` new issues — an agent at 2/3 still starts exactly one.
- **Deferral audit.** Each deferred start writes an `activity_log` entry so operators see *why* work
  isn't starting.
- **Opt-in.** Enforcement is active only when `runtimeConfig.heartbeat.wipLimit.enabled` — disabled
  agents behave byte-identically to today.

**Out (deferred to later 061 slices)**
- Team-level and workflow-stage (status-column) WIP limits.
- Start/finish-ratio "thrash" alarms and chronic-at-limit detection.
- An **agent-facing** nudge (injecting "you're at WIP, finish first" into a run's prompt). This slice
  defers new starts and audits them for the operator; it does not alter prompt assembly.
- Changing the checkout point, the flow metrics, or the UI (all shipped in the observability slice).

**Boundary (explicitly not covered)**
- The gate covers the **autonomous** run-selection path only. An *explicit* checkout — an operator
  or agent calling the checkout endpoint (`server/src/routes/issues.ts`, `svc.checkout(...)`) — also
  flips an issue to `in_progress` and is **not** WIP-gated, by design: WIP enforcement steers
  autonomous starts, it does not block a human/agent deliberately picking up work. So an agent's
  in-progress count can exceed its WIP limit via explicit checkout; the gate only prevents the
  *autonomous loop* from starting new work past the limit. (Decision 1's "single choke point" is
  the single choke point for **autonomous** starts, not for every possible `→ in_progress`
  transition.)

**Not built (already exists — reused from the observability slice)**
- `parseWipLimitConfig(runtimeConfig)` and `wipLimitSchema` (`server/src/services/wip-flow.ts`,
  `packages/shared/.../agent-heartbeat.ts`).
- `inProgressIssueCountsByAgent(companyId, agentId?)` (`server/src/services/issues.ts`) — the
  single-agent in-progress count, reused here at gate time. **No new schema, no migration.**
- `logActivity(db, input)` (`server/src/services/activity-log.ts`) — the audit sink.

## Design decisions (locked)

1. **Gate at selection, which is the complete single choke point.** `executeRun` has exactly one
   caller — `startNextQueuedRunForAgent` (`heartbeat.ts:8780`), reached from every tick / wakeup /
   promotion path (`:8458`, `:8484`, `:10649`, `:11265`, `:12003`, `:12020`, `:12186`, `:12357`).
   So the issue-status flip to `in_progress` (the checkout at `heartbeat.ts:8842` /
   `issues.ts:5438`) can *only* happen for a run that this function claimed and dispatched. Refining
   the claim loop (`claimUpTo`, `heartbeat.ts:8696`) therefore gates **every** path new work can
   start — no bypass. We do not touch the checkout point.

2. **Race-free with no new lock.** `startNextQueuedRunForAgent` already runs inside
   `withAgentStartLock(agentId, …)` (`heartbeat.ts:8635`), so an agent's count-then-claim is
   serialized against its own concurrent ticks. Two ticks can't collectively over-admit new starts
   for the same agent. WIP is a *per-agent* constraint (an agent's own in-progress issues), so it
   needs no instance-wide lock — unlike the compute-cap admission, which does.

3. **A *new start* is precisely `issueStatus ∈ {todo, backlog, blocked}`.** These are exactly the
   `expectedStatuses` the checkout uses (`issues.ts:5438`), i.e. the statuses that flip to
   `in_progress`. A queued run whose issue is already `in_progress` (continuation), `in_review`, or
   any other status does **not** increment WIP and is never gated. A queued run with **no** issueId
   (monitor/automation runs) is never a new start.

4. **WIP is a second budget dimension layered onto the existing compute budget.** The compute budget
   (`availableSlots`, instance cap, company cap) remains the *outer* bound on total claims. Within
   that, `newStartBudget = enabled ? max(0, wipLimit − currentInProgress) : Infinity` bounds how many
   *new-start* claims are allowed this sweep. Continuations consume compute budget but not
   `newStartBudget`. Because both the cap and no-cap admission branches call the same `claimUpTo`,
   refining `claimUpTo` covers both with one change.

5. **Opt-in ⇒ exact parity when disabled.** `newStartBudget = Infinity` when
   `wipLimit.enabled === false`, so the skip condition (`newStartsClaimed >= newStartBudget`) is
   never true and the loop claims exactly as it does today. No agent that hasn't opted in sees any
   behavior change.

6. **Fail-open on count error.** If `inProgressIssueCountsByAgent` throws at gate time, treat
   `newStartBudget = Infinity` and log a warning — mirroring the admission COUNT-error fail-open
   (`heartbeat.ts:8771`). A transient DB hiccup must never *halt* an agent's admission; over-admit
   risk is transient and self-corrects next sweep.

7. **The claim decision is pure and unit-tested.** The status classification and the
   claim-vs-defer decision live in `wip-flow.ts` as pure functions, so the gate logic is verified
   without the heartbeat harness; the harness test then locks the end-to-end wiring.

## Architecture

Two layers: a pure decision helper (new, in the existing `wip-flow.ts`) and the claim-loop
refinement + audit (in `heartbeat.ts`). No new files besides tests.

### 1. Pure decision helpers — `server/src/services/wip-flow.ts` (extend)

```ts
/** The issue statuses a checkout flips to in_progress (issues.ts checkout expectedStatuses). */
export const WIP_NEW_START_STATUSES = new Set(["todo", "backlog", "blocked"]);

/** A queued run is a "new start" (raises WIP) iff its issue is checkout-eligible. */
export function isNewStartIssueStatus(status: string | null | undefined): boolean {
  return status != null && WIP_NEW_START_STATUSES.has(status);
}

/**
 * newStartBudget for an admission sweep. Infinity when WIP enforcement is
 * disabled (opt-in parity); otherwise the remaining in-progress headroom.
 */
export function newStartBudget(cfg: WipLimitConfig, currentInProgress: number): number {
  if (!cfg.enabled) return Infinity;
  return Math.max(0, cfg.maxInProgress - currentInProgress);
}
```

### 2. Claim-loop refinement — `server/src/services/heartbeat.ts`

Inside `startNextQueuedRunForAgent`, after `availableSlots` is known and before `claimUpTo` is
defined, resolve the WIP budget once (fail-open):

```ts
const wipCfg = parseWipLimitConfig(agent.runtimeConfig);
let wipBudget = Infinity;
if (wipCfg.enabled) {
  try {
    const counts = await issuesSvc.inProgressIssueCountsByAgent(agent.companyId, agentId);
    wipBudget = newStartBudget(wipCfg, counts.get(agentId) ?? 0);
  } catch (err) {
    logger.warn({ err }, "WIP in-progress count failed; admitting without WIP gate this sweep");
    wipBudget = Infinity; // fail-open, never halt admission
  }
}
```

Then refine `claimUpTo` so a new-start candidate is skipped (and audited once) when the WIP budget is
exhausted, while continuations still claim within the compute budget:

```ts
let newStartsClaimed = 0;
const claimUpTo = async (budget: number) => {
  for (const queuedRun of prioritizedRuns) {
    if (claimedRuns.length >= budget) break;
    const issueId = readNonEmptyString(parseObject(queuedRun.contextSnapshot).issueId);
    const isNewStart = isNewStartIssueStatus(issueId ? issueById.get(issueId)?.status : null);
    if (isNewStart && newStartsClaimed >= wipBudget) {
      if (issueId) await auditWipDeferral(agent, queuedRun.id, issueId, wipCfg, wipBudget);
      continue; // leave queued; steer the agent to finish existing work
    }
    const claimed = await claimQueuedRun(queuedRun, companyAgents);
    if (claimed) {
      claimedRuns.push(claimed);
      if (isNewStart) newStartsClaimed += 1;
    }
  }
};
```

`wipBudget = Infinity` (disabled or fail-open) makes `newStartsClaimed >= wipBudget` always false, so
this is byte-identical to the current loop for non-opted-in agents.

### 3. Deferral audit — `server/src/services/heartbeat.ts`

```ts
async function auditWipDeferral(agent, runId, issueId, cfg, budget) {
  await logActivity(db, {
    companyId: agent.companyId,
    actorType: "system",
    actorId: "wip-flow-control",
    agentId: agent.id,
    runId,
    action: "issue.start_deferred_wip_limit",
    entityType: "issue",
    entityId: issueId,
    details: { maxInProgress: cfg.maxInProgress, newStartBudget: budget },
  });
}
```

Audit is best-effort: a `logActivity` failure must not abort the sweep (wrap the call so an audit
error is logged and swallowed, never propagated into admission).

## Data flow

```
tick / wakeup / promotion ─▶ startNextQueuedRunForAgent  (withAgentStartLock: per-agent serialized)
   │  parseWipLimitConfig(runtimeConfig)
   │  enabled? inProgressIssueCountsByAgent(companyId, agentId) ─▶ newStartBudget()   [fail-open ∞]
   ▼
claimUpTo(computeBudget):
   for each prioritized queued run:
     isNewStart = isNewStartIssueStatus(issueById.get(issueId)?.status)
     new-start & budget exhausted ─▶ skip + auditWipDeferral (leave queued)
     else ─▶ claimQueuedRun (continuation or in-budget new start) ─▶ executeRun ─▶ checkout flip
```

## Error handling

- **WIP count query throws:** `wipBudget = Infinity`, warn, admit ungated this sweep (fail-open).
- **Audit write throws:** logged and swallowed; admission proceeds (the gate already took effect).
- **Disabled / absent config:** `parseWipLimitConfig` returns disabled defaults ⇒ `Infinity` ⇒ no
  gating, no count query issued (skip the query entirely when `!cfg.enabled`).
- **`currentInProgress ≥ limit`:** `newStartBudget = 0` ⇒ zero new starts, continuations only — the
  intended "stop starting" state, not an error.
- **Non-issue run (no issueId):** never a new start; always eligible (subject to compute budget).

## Testing

- **Pure** (`wip-flow.test.ts`, extend): `isNewStartIssueStatus` for each status
  (`todo/backlog/blocked → true`; `in_progress/in_review/done/cancelled/null → false`);
  `newStartBudget` disabled → `Infinity`, under/at/over limit → headroom / 0.
- **Integration** (`heartbeat-wip-enforcement-tick.test.ts`, modeled on
  `heartbeat-idle-backoff-tick.test.ts`, embedded Postgres):
  - Enabled agent at limit 3 with 3 in-progress issues + one queued **continuation** run
    (`in_progress` issue) + one queued **new-start** run (`todo` issue): only the continuation is
    claimed (`queued→running`), the new-start stays `queued`, and one
    `issue.start_deferred_wip_limit` activity row is written.
  - Enabled agent at limit 3 with 2 in-progress + two queued new-starts: exactly **one** new-start
    claimed, one deferred.
  - **Disabled agent** (parity): all queued runs claimed regardless of in-progress count; no audit
    rows.
  - Count-query failure (inject a throw): admits all (fail-open); a warning is logged.

## Exit criteria

- An opted-in agent at its WIP limit does not start any new `todo/backlog/blocked` issue on a tick,
  but every queued run continuing an already-`in_progress` issue still starts; each deferred start
  produces an `issue.start_deferred_wip_limit` audit row naming the issue and the limit.
- An opted-in agent with headroom `k` starts at most `k` new issues per sweep and continues
  in-progress work freely.
- A non-opted-in agent's admission is byte-identical to before this slice (no deferrals, no audit,
  no extra count query).
- A transient in-progress-count failure admits work ungated for that sweep rather than halting the
  agent.
