# WIP Enforcement Pull-Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate new-issue starts for an opted-in agent at/over its WIP limit — defer new starts (audited), always allow continuations of in-progress work — at the single run-selection choke point.

**Architecture:** Extend the existing pure `wip-flow.ts` with a status classifier + budget function, then refine the `claimUpTo` loop inside `startNextQueuedRunForAgent` (heartbeat.ts) to skip+audit new-start candidates once the WIP budget is exhausted. Reuses the 4A-ii config parser and in-progress count query. No new schema, no migration.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Vitest + embedded Postgres, `@paperclipai/shared`.

## Global Constraints

- **Base branch:** this work is stacked on `feat/combo-01-wip-flow-control` (the 4A-ii observability slice); `parseWipLimitConfig`, `wipLimitSchema`, `inProgressIssueCountsByAgent`, and `logActivity` all already exist there.
- **Single choke point:** the gate lives ONLY in `startNextQueuedRunForAgent`'s `claimUpTo` loop (heartbeat.ts:8696). `executeRun` has exactly one caller (heartbeat.ts:8780), so this covers every path that flips an issue to `in_progress`. Do NOT touch the checkout (`heartbeat.ts:8842` / `issues.ts:5438`) or `executeRun`.
- **A "new start" is exactly `issueStatus ∈ {todo, backlog, blocked}`** — the checkout `expectedStatuses`. `in_progress` (continuation), `in_review`, other statuses, and runs with no issueId are NOT new starts and are never gated.
- **Budget, not binary:** `newStartBudget = max(0, wipLimit − currentInProgress)`; continuations don't consume it.
- **Opt-in parity:** `wipLimit.enabled === false` ⇒ `newStartBudget = Infinity` ⇒ loop byte-identical to today; skip the count query entirely when disabled.
- **Fail-open:** if the in-progress count query throws, `wipBudget = Infinity`, warn, admit ungated this sweep (mirror heartbeat.ts:8771). Audit failures are logged and swallowed, never propagated into admission.
- `startNextQueuedRunForAgent` runs inside `withAgentStartLock(agentId)` (heartbeat.ts:8635) — the count-then-claim is already per-agent serialized; add NO new lock.
- `issuesSvc = issueService(db)` is already in scope at heartbeat.ts:3435; `logActivity` is already imported at heartbeat.ts:112.
- **Correct focused test command** (the `pnpm --filter … test` form silently no-ops): `cd server && npx vitest run <pattern>`; typecheck `cd server && npx tsc --noEmit`.

---

### Task 1: Pure WIP-enforcement helpers

**Files:**
- Modify: `server/src/services/wip-flow.ts`
- Test: `server/src/services/wip-flow.test.ts`

**Interfaces:**
- Consumes: `WipLimitConfig` (already imported in this file).
- Produces:
  - `WIP_NEW_START_STATUSES: Set<string>`
  - `isNewStartIssueStatus(status: string | null | undefined): boolean`
  - `newStartBudget(cfg: WipLimitConfig, currentInProgress: number): number`

- [ ] **Step 1: Write the failing test**

Append to `server/src/services/wip-flow.test.ts`:

```ts
import { isNewStartIssueStatus, newStartBudget, WIP_NEW_START_STATUSES } from "./wip-flow.js";

describe("isNewStartIssueStatus", () => {
  it("is true only for checkout-eligible statuses", () => {
    for (const s of ["todo", "backlog", "blocked"]) expect(isNewStartIssueStatus(s)).toBe(true);
    for (const s of ["in_progress", "in_review", "done", "cancelled"]) expect(isNewStartIssueStatus(s)).toBe(false);
  });
  it("is false for null/undefined (non-issue runs)", () => {
    expect(isNewStartIssueStatus(null)).toBe(false);
    expect(isNewStartIssueStatus(undefined)).toBe(false);
  });
  it("exposes the exact status set", () => {
    expect([...WIP_NEW_START_STATUSES].sort()).toEqual(["backlog", "blocked", "todo"]);
  });
});

describe("newStartBudget", () => {
  it("is Infinity when disabled (opt-in parity)", () => {
    expect(newStartBudget({ enabled: false, maxInProgress: 3 }, 99)).toBe(Infinity);
  });
  it("is the remaining headroom when enabled", () => {
    expect(newStartBudget({ enabled: true, maxInProgress: 3 }, 1)).toBe(2);
    expect(newStartBudget({ enabled: true, maxInProgress: 3 }, 3)).toBe(0);
    expect(newStartBudget({ enabled: true, maxInProgress: 3 }, 5)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run wip-flow`
Expected: FAIL — `isNewStartIssueStatus` / `newStartBudget` / `WIP_NEW_START_STATUSES` not exported.

- [ ] **Step 3: Add the helpers**

Append to `server/src/services/wip-flow.ts`:

```ts
/** The issue statuses a checkout flips to in_progress (issues.ts checkout expectedStatuses). */
export const WIP_NEW_START_STATUSES = new Set(["todo", "backlog", "blocked"]);

/** A queued run is a "new start" (raises WIP) iff its issue is checkout-eligible. */
export function isNewStartIssueStatus(status: string | null | undefined): boolean {
  return status != null && WIP_NEW_START_STATUSES.has(status);
}

/**
 * New-start budget for one admission sweep. Infinity when WIP enforcement is
 * disabled (opt-in parity); otherwise the remaining in-progress headroom.
 */
export function newStartBudget(cfg: WipLimitConfig, currentInProgress: number): number {
  if (!cfg.enabled) return Infinity;
  return Math.max(0, cfg.maxInProgress - currentInProgress);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run wip-flow`
Expected: PASS (existing wip-flow tests + the new ones).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/wip-flow.ts server/src/services/wip-flow.test.ts
git commit -m "feat(wip): pure new-start classifier + budget helpers for enforcement"
```

---

### Task 2: WIP gate + deferral audit in the claim loop

**Files:**
- Modify: `server/src/services/heartbeat.ts` (import from `./wip-flow.js`; add `auditWipDeferral` helper near the other admission helpers; resolve `wipBudget` in `startNextQueuedRunForAgent` after `availableSlots`; refine `claimUpTo`)
- Test: `server/src/__tests__/heartbeat-wip-enforcement-tick.test.ts` (new; model the harness on `server/src/__tests__/heartbeat-instance-admission.test.ts`, which already seeds queued runs, calls `startNextQueuedRunForAgent`, and asserts claim decisions while tolerating the fire-and-forget `executeRun`)

**Interfaces:**
- Consumes: `parseWipLimitConfig`, `isNewStartIssueStatus`, `newStartBudget` (Task 1 + 4A-ii); `issuesSvc.inProgressIssueCountsByAgent` (4A-ii); `logActivity` (existing).
- Produces: enforcement behavior at `startNextQueuedRunForAgent`; audit action `issue.start_deferred_wip_limit`.

- [ ] **Step 1: Write the failing integration test**

Create `server/src/__tests__/heartbeat-wip-enforcement-tick.test.ts`. Model imports/setup on `heartbeat-instance-admission.test.ts` (embedded Postgres; `heartbeat = heartbeatService(db)`; seed `companies`, `agents`, `issues`, `heartbeatRuns`). Each queued run's issue is carried in `contextSnapshot.issueId`. Cover these cases:

```ts
// Helper: seed an agent with WIP enabled at limit 3, plus issues + queued runs.
// A queued run's contextSnapshot must be { issueId } so the loop resolves its issue status.

it("defers a new-start but claims a continuation when the agent is at its WIP limit", async () => {
  // 3 in_progress issues assigned to the agent (currentInProgress = 3, limit = 3 => budget 0)
  // one queued run whose issue is in_progress (continuation)
  // one queued run whose issue is todo (new start)
  const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
  const claimedIssueIds = /* map claimed runs -> their contextSnapshot.issueId */;
  expect(claimedIssueIds).toContain(inProgressIssueId);   // continuation claimed
  expect(claimedIssueIds).not.toContain(todoIssueId);      // new start deferred
  // deferred run still queued:
  const todoRun = await getRun(todoRunId);
  expect(todoRun.status).toBe("queued");
  // audit row written:
  const audits = await db.select().from(activityLog)
    .where(and(eq(activityLog.action, "issue.start_deferred_wip_limit"), eq(activityLog.entityId, todoIssueId)));
  expect(audits).toHaveLength(1);
});

it("with headroom of 1 (2 in_progress, limit 3), claims exactly one of two new-starts", async () => {
  const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
  const newStartsClaimed = /* count claimed runs whose issue was todo */;
  expect(newStartsClaimed).toBe(1);
});

it("disabled agent: claims all queued runs regardless of in-progress count (parity), no audit", async () => {
  // wipLimit.enabled = false, 5 in_progress, two queued todo new-starts + compute budget >= 2
  const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
  expect(claimed.length).toBe(2);
  const audits = await db.select().from(activityLog).where(eq(activityLog.action, "issue.start_deferred_wip_limit"));
  expect(audits).toHaveLength(0);
});
```

(Set each agent's `runtimeConfig.heartbeat.wipLimit` and a `maxConcurrentRuns` high enough that the compute budget never masks the WIP effect. Import `activityLog`, `and`, `eq` from the same places `heartbeat-instance-admission.test.ts` / other suites do.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run heartbeat-wip-enforcement-tick`
Expected: FAIL — the new-start is claimed (no gate yet) and no audit row exists. Confirm it's a real assertion failure, not an empty exit-0 or a harness error.

- [ ] **Step 3: Add the import**

At the top of `server/src/services/heartbeat.ts`, add:

```ts
import { parseWipLimitConfig, isNewStartIssueStatus, newStartBudget } from "./wip-flow.js";
```

- [ ] **Step 4: Add the audit helper**

Near the other admission/claim helpers in `heartbeat.ts` (module-internal function, `db`/`logActivity` in scope):

```ts
async function auditWipDeferral(
  agent: { id: string; companyId: string },
  runId: string,
  issueId: string,
  cfg: { maxInProgress: number },
  budget: number,
) {
  try {
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
  } catch (err) {
    logger.warn({ err, issueId, runId }, "WIP deferral audit failed; continuing admission");
  }
}
```

- [ ] **Step 5: Resolve the WIP budget in `startNextQueuedRunForAgent`**

In `startNextQueuedRunForAgent`, immediately after `if (availableSlots <= 0) return [];` (heartbeat.ts:8648) — before the queued-runs query — add:

```ts
const wipCfg = parseWipLimitConfig(agent.runtimeConfig);
let wipBudget = Infinity;
if (wipCfg.enabled) {
  try {
    const counts = await issuesSvc.inProgressIssueCountsByAgent(agent.companyId, agentId);
    wipBudget = newStartBudget(wipCfg, counts.get(agentId) ?? 0);
  } catch (err) {
    logger.warn({ err }, "WIP in-progress count failed; admitting without WIP gate this sweep");
    wipBudget = Infinity;
  }
}
```

- [ ] **Step 6: Refine `claimUpTo`**

Replace the `claimUpTo` definition (heartbeat.ts:8695-8702) with the WIP-aware version:

```ts
const claimedRuns: Array<typeof heartbeatRuns.$inferSelect> = [];
let newStartsClaimed = 0;
const claimUpTo = async (budget: number) => {
  for (const queuedRun of prioritizedRuns) {
    if (claimedRuns.length >= budget) break;
    const issueId = readNonEmptyString(parseObject(queuedRun.contextSnapshot).issueId);
    const isNewStart = isNewStartIssueStatus(issueId ? issueById.get(issueId)?.status : null);
    if (isNewStart && newStartsClaimed >= wipBudget) {
      if (issueId) await auditWipDeferral(agent, queuedRun.id, issueId, wipCfg, wipBudget);
      continue; // leave queued; steer the agent to finish in-progress work first
    }
    const claimed = await claimQueuedRun(queuedRun, companyAgents);
    if (claimed) {
      claimedRuns.push(claimed); // claim flips queued→running atomically
      if (isNewStart) newStartsClaimed += 1;
    }
  }
};
```

- [ ] **Step 7: Run the integration test to verify it passes**

Run: `cd server && npx vitest run heartbeat-wip-enforcement-tick`
Expected: PASS (all three cases).

- [ ] **Step 8: Run the admission regression suite (guard the shared claim loop)**

Run: `cd server && npx vitest run heartbeat-instance-admission predictive-breaker.integration panic-drain.integration`
Expected: PASS — the refined `claimUpTo` must not regress the cap/breaker/drain admission paths (they share this loop; `wipBudget = Infinity` for their agents ⇒ identical behavior).

- [ ] **Step 9: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/heartbeat-wip-enforcement-tick.test.ts
git commit -m "feat(wip): gate new-issue starts at the WIP limit in run selection"
```

---

### Task 3: Typecheck + regression gate

**Files:** none (verification task)

- [ ] **Step 1: Server typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 2: Full touched-area suites**

Run: `cd server && npx vitest run "wip-flow" "heartbeat-wip-enforcement" "heartbeat-instance-admission"`
Expected: all PASS (embedded-Postgres suites may SKIP if unsupported — note it if so).

- [ ] **Step 3: Full workspace typecheck**

Run (from repo root): `pnpm -r typecheck`
Expected: GREEN (it was made green on the base branch; this slice adds no new required types).

- [ ] **Step 4: Verify the branch**

```bash
git log --oneline feat/combo-01-wip-flow-control..HEAD
```
Expected: three feature commits (Tasks 1–2 plus the spec), all tests green.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-12-wip-enforcement-design.md`):
- Pure classifier + budget (spec §Architecture 1) → Task 1.
- Gate in `claimUpTo` at the single choke point, budgeted (spec §Architecture 2, §decisions 1/3/4) → Task 2 Steps 5–6.
- Deferral audit `issue.start_deferred_wip_limit` (spec §Architecture 3) → Task 2 Steps 4/6.
- Opt-in parity when disabled (spec §decision 5) → Task 1 `newStartBudget` Infinity branch (unit) + Task 2 disabled-agent integration case + Step 8 regression.
- Fail-open on count error (spec §decision 6) → Task 2 Step 5 try/catch; audit fail-open → Step 4 try/catch.
- No touch to checkout/executeRun (spec §Scope, §decision 1) → no task edits those.
- "New start" = `{todo,backlog,blocked}` (spec §decision 3) → Task 1 `WIP_NEW_START_STATUSES` + tests.

**Placeholder scan:** the integration-test step uses `/* … */` sketches for the seed/derive glue (issueId extraction, claimed→issueId mapping) rather than full literal code, because the exact seeding boilerplate must match the `heartbeat-instance-admission.test.ts` harness the implementer copies — the assertions (claimed contains continuation, excludes new-start, deferred run still `queued`, one audit row, exactly-one-of-two, parity + zero audits) are fully specified. This is a deliberate "copy the named harness, fill its seed pattern" instruction, not an under-specified requirement.

**Type consistency:** `newStartBudget`/`isNewStartIssueStatus`/`WIP_NEW_START_STATUSES` names identical across Task 1 (definition) and Task 2 (import + use). `wipBudget` (number, possibly Infinity) and `newStartsClaimed` (number) are consistent in Task 2. The audit action string `issue.start_deferred_wip_limit` is identical in the helper (Step 4), the loop call (Step 6), and the test assertions (Step 1).
