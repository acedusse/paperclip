# WIP Limits & Flow Control (4A-ii) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each agent a per-agent WIP limit (opt-in), a live in-progress count with a soft over-limit warning, and on-read flow metrics (cycle time, throughput) — surfaced in the agents list and config form.

**Architecture:** Mirror the just-merged 4A-i idle-backoff layering exactly: a Zod config schema in shared → a pure server module (`wip-flow.ts`) that does all math → two grouped issue-table query helpers → attach `wip`/`flow` fields on the agent read/list routes → a compact UI readout + config controls. No DB migration; counts and metrics come from existing `issues` columns. **Observability only — nothing is gated on the limit this slice.**

**Tech Stack:** TypeScript, Zod, Drizzle ORM (Postgres), Express, Vitest + supertest, React, `@paperclipai/shared` monorepo package.

## Global Constraints

- **Config location:** per-agent WIP config lives at `runtimeConfig.heartbeat.wipLimit` (sibling of `idleBackoff`). `runtimeConfig` is existing JSONB — **no migration**.
- **Opt-in default:** `wipLimit.enabled` defaults `false`. When disabled, `wip.limit` is `null` and `wip.overLimit` is always `false`; count and flow metrics still compute.
- **"In progress" = `issues.status === "in_progress"`** only. `in_review` excluded this slice.
- **No gate:** do NOT modify `startNextQueuedRunForAgent`, run selection, or the checkout flip. Over-limit is a warning field + UI styling only.
- **List-safety:** the agents-list route must compute all agents' WIP/flow with **two grouped queries total**, not two per agent.
- **Flow window:** fixed trailing **7 days**, computed via SQL `completedAt >= now − 7d`. `medianCycleTimeMs` is `null` when the window has no completions.
- **Attribution:** issues attribute to their current `assigneeAgentId` (no reassignment history).
- Follow existing file conventions (the `[META]`/`[START]`/`[END]` header comments on new files in `server/src/services` and `ui/src/components`).

---

### Task 1: WIP config schema (shared validator)

**Files:**
- Modify: `packages/shared/src/validators/agent-heartbeat.ts`
- Test: `packages/shared/src/validators/agent-heartbeat.test.ts`

**Interfaces:**
- Produces: `wipLimitSchema` (Zod), `WipLimitConfig = { enabled: boolean; maxInProgress: number }`. Auto-exported from `@paperclipai/shared` via the existing `export * from "./validators/agent-heartbeat.js"` at `packages/shared/src/index.ts:865`.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/validators/agent-heartbeat.test.ts`:

```ts
import { wipLimitSchema } from "./agent-heartbeat.js";

describe("wipLimitSchema", () => {
  it("defaults to disabled with a maxInProgress of 3", () => {
    expect(wipLimitSchema.parse({})).toEqual({ enabled: false, maxInProgress: 3 });
  });

  it("accepts an explicit enabled limit", () => {
    expect(wipLimitSchema.parse({ enabled: true, maxInProgress: 5 })).toEqual({
      enabled: true,
      maxInProgress: 5,
    });
  });

  it("rejects a non-positive or non-integer maxInProgress", () => {
    expect(() => wipLimitSchema.parse({ maxInProgress: 0 })).toThrow();
    expect(() => wipLimitSchema.parse({ maxInProgress: -1 })).toThrow();
    expect(() => wipLimitSchema.parse({ maxInProgress: 2.5 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/shared test -- agent-heartbeat`
Expected: FAIL — `wipLimitSchema` is not exported.

- [ ] **Step 3: Add the schema**

In `packages/shared/src/validators/agent-heartbeat.ts`, after `idleBackoffSchema`/`IdleBackoffConfig`:

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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @paperclipai/shared test -- agent-heartbeat`
Expected: PASS.

- [ ] **Step 5: Build shared so downstream packages see the type**

Run: `pnpm --filter @paperclipai/shared build`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/validators/agent-heartbeat.ts packages/shared/src/validators/agent-heartbeat.test.ts
git commit -m "feat(shared): wipLimit config schema for 4A-ii WIP limits"
```

---

### Task 2: Pure WIP/flow module (server, no DB)

**Files:**
- Create: `server/src/services/wip-flow.ts`
- Test: `server/src/services/wip-flow.test.ts`

**Interfaces:**
- Consumes: `wipLimitSchema`, `WipLimitConfig` from `@paperclipai/shared` (Task 1).
- Produces:
  - `WipStatus = { limit: number | null; current: number; overBy: number; overLimit: boolean }`
  - `FlowMetrics = { throughputLast7d: number; medianCycleTimeMs: number | null }`
  - `WipFlowFields = { wip: WipStatus; flow: FlowMetrics }`
  - `parseWipLimitConfig(runtimeConfig: unknown): WipLimitConfig`
  - `wipStatus(current: number, cfg: WipLimitConfig): WipStatus`
  - `computeFlowMetrics(rows: { startedAt: Date | null; completedAt: Date }[]): FlowMetrics`
  - `buildAgentWipFlow(runtimeConfig: unknown, current: number, completions: { startedAt: Date | null; completedAt: Date }[]): WipFlowFields`

- [ ] **Step 1: Write the failing test**

Create `server/src/services/wip-flow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildAgentWipFlow, computeFlowMetrics, parseWipLimitConfig, wipStatus } from "./wip-flow.js";

describe("wipStatus", () => {
  it("reports no limit when disabled", () => {
    expect(wipStatus(4, { enabled: false, maxInProgress: 3 })).toEqual({
      limit: null, current: 4, overBy: 0, overLimit: false,
    });
  });
  it("is under the limit", () => {
    expect(wipStatus(2, { enabled: true, maxInProgress: 3 })).toEqual({
      limit: 3, current: 2, overBy: 0, overLimit: false,
    });
  });
  it("is exactly at the limit (not over)", () => {
    expect(wipStatus(3, { enabled: true, maxInProgress: 3 })).toMatchObject({ overBy: 0, overLimit: false });
  });
  it("is over the limit", () => {
    expect(wipStatus(5, { enabled: true, maxInProgress: 3 })).toEqual({
      limit: 3, current: 5, overBy: 2, overLimit: true,
    });
  });
});

describe("computeFlowMetrics", () => {
  const start = new Date("2026-07-10T00:00:00.000Z");
  it("returns zero throughput and null median for an empty window", () => {
    expect(computeFlowMetrics([])).toEqual({ throughputLast7d: 0, medianCycleTimeMs: null });
  });
  it("computes throughput and median cycle time (odd count)", () => {
    const rows = [
      { startedAt: start, completedAt: new Date(start.getTime() + 1000) },
      { startedAt: start, completedAt: new Date(start.getTime() + 3000) },
      { startedAt: start, completedAt: new Date(start.getTime() + 2000) },
    ];
    expect(computeFlowMetrics(rows)).toEqual({ throughputLast7d: 3, medianCycleTimeMs: 2000 });
  });
  it("averages the two middle cycle times (even count)", () => {
    const rows = [
      { startedAt: start, completedAt: new Date(start.getTime() + 1000) },
      { startedAt: start, completedAt: new Date(start.getTime() + 3000) },
    ];
    expect(computeFlowMetrics(rows).medianCycleTimeMs).toBe(2000);
  });
  it("counts throughput but skips a row with no startedAt for cycle time", () => {
    const rows = [
      { startedAt: null, completedAt: new Date(start.getTime() + 5000) },
      { startedAt: start, completedAt: new Date(start.getTime() + 1000) },
    ];
    expect(computeFlowMetrics(rows)).toEqual({ throughputLast7d: 2, medianCycleTimeMs: 1000 });
  });
});

describe("parseWipLimitConfig / buildAgentWipFlow", () => {
  it("reads runtimeConfig.heartbeat.wipLimit", () => {
    expect(parseWipLimitConfig({ heartbeat: { wipLimit: { enabled: true, maxInProgress: 2 } } })).toEqual({
      enabled: true, maxInProgress: 2,
    });
  });
  it("falls back to defaults for an absent config", () => {
    expect(parseWipLimitConfig(null)).toEqual({ enabled: false, maxInProgress: 3 });
  });
  it("assembles wip + flow fields", () => {
    const result = buildAgentWipFlow({ heartbeat: { wipLimit: { enabled: true, maxInProgress: 1 } } }, 2, []);
    expect(result).toEqual({
      wip: { limit: 1, current: 2, overBy: 1, overLimit: true },
      flow: { throughputLast7d: 0, medianCycleTimeMs: null },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- wip-flow`
Expected: FAIL — cannot find `./wip-flow.js`.

- [ ] **Step 3: Create the module**

Create `server/src/services/wip-flow.ts`:

```ts
import { wipLimitSchema, type WipLimitConfig } from "@paperclipai/shared";

export interface WipStatus {
  limit: number | null;
  current: number;
  overBy: number;
  overLimit: boolean;
}

export interface FlowMetrics {
  throughputLast7d: number;
  medianCycleTimeMs: number | null;
}

export interface WipFlowFields {
  wip: WipStatus;
  flow: FlowMetrics;
}

/** Parse just the WIP-limit fields from an agent's runtimeConfig blob. */
export function parseWipLimitConfig(runtimeConfig: unknown): WipLimitConfig {
  const hb = (runtimeConfig as { heartbeat?: Record<string, unknown> } | null)?.heartbeat ?? {};
  return wipLimitSchema.parse(hb.wipLimit ?? {});
}

/** Current in-progress load vs the configured cap. Disabled → no limit, never over. */
export function wipStatus(current: number, cfg: WipLimitConfig): WipStatus {
  if (!cfg.enabled) return { limit: null, current, overBy: 0, overLimit: false };
  const overBy = Math.max(0, current - cfg.maxInProgress);
  return { limit: cfg.maxInProgress, current, overBy, overLimit: overBy > 0 };
}

/** Median of a numeric array (sorted copy); null on empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Flow metrics over issues the agent COMPLETED in the (SQL-windowed) trailing
 * 7 days. Throughput is the row count; cycle time is the median of
 * completedAt − startedAt, skipping rows that never recorded a start.
 */
export function computeFlowMetrics(rows: { startedAt: Date | null; completedAt: Date }[]): FlowMetrics {
  const cycleTimes = rows
    .filter((r): r is { startedAt: Date; completedAt: Date } => r.startedAt !== null)
    .map((r) => r.completedAt.getTime() - r.startedAt.getTime())
    .filter((ms) => ms >= 0);
  return { throughputLast7d: rows.length, medianCycleTimeMs: median(cycleTimes) };
}

/** Assemble the { wip, flow } fields attached to an agent read/list response. */
export function buildAgentWipFlow(
  runtimeConfig: unknown,
  current: number,
  completions: { startedAt: Date | null; completedAt: Date }[],
): WipFlowFields {
  return {
    wip: wipStatus(current, parseWipLimitConfig(runtimeConfig)),
    flow: computeFlowMetrics(completions),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @paperclipai/server test -- wip-flow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/wip-flow.ts server/src/services/wip-flow.test.ts
git commit -m "feat(wip): pure wip-flow module (status + flow metrics)"
```

---

### Task 3: Issue-service query helpers (grouped counts + completions)

**Files:**
- Modify: `server/src/services/issues.ts` (add two methods to the `issueService(db)` return object, which ends at `issues.ts:6477`; ensure drizzle imports include `gte` and `isNotNull`)
- Test: `server/src/__tests__/issues-wip-flow-queries.test.ts`

**Interfaces:**
- Produces (methods on `issueService(db)`):
  - `inProgressIssueCountsByAgent(companyId: string, agentId?: string): Promise<Map<string, number>>`
  - `recentCompletionsByAgent(companyId: string, sinceIso: string, agentId?: string): Promise<Map<string, { startedAt: Date | null; completedAt: Date }[]>>`
- Both optionally filter to one agent (detail path); omitting `agentId` returns all agents in the company (list path). Both hit the existing `issues_company_assignee_status_idx`.

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/issues-wip-flow-queries.test.ts` (harness modeled on `issues-service.test.ts` — embedded Postgres, skipped when unsupported):

```ts
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { createDb, companies, agents, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.ts";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

describeEmbeddedPostgres("issueService WIP/flow queries", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-wip-flow-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const companyId = randomUUID();
    const agentA = randomUUID();
    const agentB = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: "TWIP01",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      { id: agentA, companyId, name: "A", urlKey: "a", adapterType: "process" },
      { id: agentB, companyId, name: "B", urlKey: "b", adapterType: "process" },
    ]);
    return { companyId, agentA, agentB };
  }

  it("counts in-progress issues grouped by agent", async () => {
    const { companyId, agentA, agentB } = await seed();
    await db.insert(issues).values([
      { companyId, title: "1", status: "in_progress", assigneeAgentId: agentA },
      { companyId, title: "2", status: "in_progress", assigneeAgentId: agentA },
      { companyId, title: "3", status: "todo", assigneeAgentId: agentA },
      { companyId, title: "4", status: "in_progress", assigneeAgentId: agentB },
      { companyId, title: "5", status: "done", assigneeAgentId: agentB },
    ]);
    const counts = await svc.inProgressIssueCountsByAgent(companyId);
    expect(counts.get(agentA)).toBe(2);
    expect(counts.get(agentB)).toBe(1);
  });

  it("filters counts to a single agent when agentId is given", async () => {
    const { companyId, agentA, agentB } = await seed();
    await db.insert(issues).values([
      { companyId, title: "1", status: "in_progress", assigneeAgentId: agentA },
      { companyId, title: "2", status: "in_progress", assigneeAgentId: agentB },
    ]);
    const counts = await svc.inProgressIssueCountsByAgent(companyId, agentA);
    expect(counts.get(agentA)).toBe(1);
    expect(counts.has(agentB)).toBe(false);
  });

  it("returns recent completions within the window grouped by agent", async () => {
    const { companyId, agentA } = await seed();
    const now = new Date("2026-07-12T00:00:00.000Z");
    const sinceIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const recentDone = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    const oldDone = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    await db.insert(issues).values([
      { companyId, title: "recent", status: "done", assigneeAgentId: agentA, startedAt: recentStart, completedAt: recentDone },
      { companyId, title: "old", status: "done", assigneeAgentId: agentA, startedAt: oldDone, completedAt: oldDone },
    ]);
    const completions = await svc.recentCompletionsByAgent(companyId, sinceIso);
    expect(completions.get(agentA)).toHaveLength(1);
    expect(completions.get(agentA)![0].completedAt.getTime()).toBe(recentDone.getTime());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- issues-wip-flow-queries`
Expected: FAIL — `svc.inProgressIssueCountsByAgent is not a function`. (If the embedded-postgres harness is unsupported in the environment, the suite is skipped — note that and continue; the route test in Task 4 covers the wiring.)

- [ ] **Step 3: Ensure drizzle imports**

At the top of `server/src/services/issues.ts`, confirm `and`, `eq`, `sql`, `gte`, `isNotNull` are imported from `drizzle-orm`. Add any missing ones to the existing `import { ... } from "drizzle-orm";`.

- [ ] **Step 4: Add the two methods**

Inside the `issueService(db)` return object (before its closing `};` at `issues.ts:6477`), add:

```ts
    inProgressIssueCountsByAgent: async (companyId: string, agentId?: string): Promise<Map<string, number>> => {
      const rows = await db
        .select({ agentId: issues.assigneeAgentId, count: sql<number>`count(*)` })
        .from(issues)
        .where(and(
          eq(issues.companyId, companyId),
          eq(issues.status, "in_progress"),
          isNotNull(issues.assigneeAgentId),
          ...(agentId ? [eq(issues.assigneeAgentId, agentId)] : []),
        ))
        .groupBy(issues.assigneeAgentId);
      const map = new Map<string, number>();
      for (const row of rows) {
        if (row.agentId) map.set(row.agentId, Number(row.count ?? 0));
      }
      return map;
    },
    recentCompletionsByAgent: async (
      companyId: string,
      sinceIso: string,
      agentId?: string,
    ): Promise<Map<string, { startedAt: Date | null; completedAt: Date }[]>> => {
      const rows = await db
        .select({
          agentId: issues.assigneeAgentId,
          startedAt: issues.startedAt,
          completedAt: issues.completedAt,
        })
        .from(issues)
        .where(and(
          eq(issues.companyId, companyId),
          isNotNull(issues.assigneeAgentId),
          isNotNull(issues.completedAt),
          gte(issues.completedAt, new Date(sinceIso)),
          ...(agentId ? [eq(issues.assigneeAgentId, agentId)] : []),
        ));
      const map = new Map<string, { startedAt: Date | null; completedAt: Date }[]>();
      for (const row of rows) {
        if (!row.agentId || !row.completedAt) continue;
        const list = map.get(row.agentId) ?? [];
        list.push({ startedAt: row.startedAt, completedAt: row.completedAt });
        map.set(row.agentId, list);
      }
      return map;
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @paperclipai/server test -- issues-wip-flow-queries`
Expected: PASS (or SKIP if embedded Postgres unsupported).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/issues.ts server/src/__tests__/issues-wip-flow-queries.test.ts
git commit -m "feat(wip): grouped in-progress-count and recent-completion issue queries"
```

---

### Task 4: Attach `wip`/`flow` on the agent read + list routes

**Files:**
- Modify: `server/src/routes/agents.ts`
  - Import `buildAgentWipFlow` from `../services/wip-flow.js` (next to the cadence import at `:85`).
  - `buildAgentDetail` (`:577`) — attach per-agent `wip`/`flow` (single-agent queries).
  - `GET /companies/:companyId/agents` (`:1824`) — attach `wip`/`flow` via two grouped queries, after redaction.
- Test: `server/src/__tests__/agents-wip-flow-read.test.ts`, `server/src/__tests__/agents-wip-flow-list.test.ts` (copy the harness from `agents-heartbeat-cadence-read.test.ts` / `-list.test.ts`)

**Interfaces:**
- Consumes: `buildAgentWipFlow` (Task 2), `issueService(db).inProgressIssueCountsByAgent` / `.recentCompletionsByAgent` (Task 3).
- Produces on each agent read/list entry: `wip: WipStatus`, `flow: FlowMetrics`.

- [ ] **Step 1: Write the failing read test**

Create `server/src/__tests__/agents-wip-flow-read.test.ts` by copying `agents-heartbeat-cadence-read.test.ts`, then:
1. Extend `mockIssueService` (currently `{ list: vi.fn() }`) with the two new methods:

```ts
const mockIssueService = vi.hoisted(() => ({
  list: vi.fn(),
  inProgressIssueCountsByAgent: vi.fn(),
  recentCompletionsByAgent: vi.fn(),
}));
```

2. In the test body, set the agent's config and mock returns, then assert:

```ts
it("exposes wip status and flow metrics on GET /api/agents/:id", async () => {
  const start = new Date("2026-07-11T00:00:00.000Z");
  mockAgentService.getById.mockResolvedValue({
    ...baseAgent,
    runtimeConfig: { heartbeat: { wipLimit: { enabled: true, maxInProgress: 1 } } },
  });
  mockIssueService.inProgressIssueCountsByAgent.mockResolvedValue(new Map([[agentId, 2]]));
  mockIssueService.recentCompletionsByAgent.mockResolvedValue(
    new Map([[agentId, [{ startedAt: start, completedAt: new Date(start.getTime() + 4000) }]]]),
  );
  // ...build app + router as the cadence test does...
  const res = await request(app).get(`/api/agents/${agentId}`);
  expect(res.status).toBe(200);
  expect(res.body.wip).toEqual({ limit: 1, current: 2, overBy: 1, overLimit: true });
  expect(res.body.flow).toEqual({ throughputLast7d: 1, medianCycleTimeMs: 4000 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- agents-wip-flow-read`
Expected: FAIL — `res.body.wip` is undefined.

- [ ] **Step 3: Wire `buildAgentDetail`**

In `server/src/routes/agents.ts`, add the import near `:85`:

```ts
import { buildAgentWipFlow } from "../services/wip-flow.js";
```

In `buildAgentDetail` (`:577`), after `effectiveHeartbeatIntervalSec` is computed (`:586`), add:

```ts
    const issuesSvc = issueService(db);
    const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [wipCounts, completions] = await Promise.all([
      issuesSvc.inProgressIssueCountsByAgent(agent.companyId, agent.id),
      issuesSvc.recentCompletionsByAgent(agent.companyId, sinceIso, agent.id),
    ]);
    const wipFlow = buildAgentWipFlow(
      agent.runtimeConfig,
      wipCounts.get(agent.id) ?? 0,
      completions.get(agent.id) ?? [],
    );
```

and spread it into the returned object alongside `effectiveHeartbeatIntervalSec`:

```ts
    return {
      ...(options?.restricted ? redactForRestrictedAgentView(agent) : agent),
      effectiveHeartbeatIntervalSec,
      ...wipFlow,
      chainOfCommand,
      access: accessState,
    };
```

- [ ] **Step 4: Run the read test to verify it passes**

Run: `pnpm --filter @paperclipai/server test -- agents-wip-flow-read`
Expected: PASS.

- [ ] **Step 5: Write the failing list test**

Create `server/src/__tests__/agents-wip-flow-list.test.ts` by copying `agents-heartbeat-cadence-list.test.ts` and adding the same `mockIssueService` methods. Assert the grouped path attaches per-agent fields and calls each grouped query exactly once:

```ts
it("attaches wip/flow to each agent with two grouped queries", async () => {
  mockAgentService.list.mockResolvedValue([
    { ...baseAgent, id: agentId, runtimeConfig: { heartbeat: { wipLimit: { enabled: true, maxInProgress: 3 } } } },
  ]);
  mockIssueService.inProgressIssueCountsByAgent.mockResolvedValue(new Map([[agentId, 4]]));
  mockIssueService.recentCompletionsByAgent.mockResolvedValue(new Map());
  // ...build app + router...
  const res = await request(app).get(`/api/companies/${companyId}/agents`);
  expect(res.status).toBe(200);
  expect(res.body[0].wip).toEqual({ limit: 3, current: 4, overBy: 1, overLimit: true });
  expect(res.body[0].flow).toEqual({ throughputLast7d: 0, medianCycleTimeMs: null });
  expect(mockIssueService.inProgressIssueCountsByAgent).toHaveBeenCalledTimes(1);
  expect(mockIssueService.recentCompletionsByAgent).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 6: Run the list test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- agents-wip-flow-list`
Expected: FAIL — `res.body[0].wip` is undefined.

- [ ] **Step 7: Wire the list route**

In `GET /companies/:companyId/agents` (`:1824`), replace the response block (`:1835-1841`) with a version that computes the two grouped queries once and attaches `wip`/`flow` **after** redaction:

```ts
    const result = await filterAgentsForActor(req, await svc.list(companyId));
    const canReadConfigs = await actorCanReadConfigurationsForCompany(req, companyId);
    const shaped = canReadConfigs ? result : result.map((agent) => redactForRestrictedAgentView(agent));

    const issuesSvc = issueService(db);
    const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [wipCounts, completions] = await Promise.all([
      issuesSvc.inProgressIssueCountsByAgent(companyId),
      issuesSvc.recentCompletionsByAgent(companyId, sinceIso),
    ]);
    res.json(shaped.map((agent) => ({
      ...agent,
      ...buildAgentWipFlow(agent.runtimeConfig, wipCounts.get(agent.id) ?? 0, completions.get(agent.id) ?? []),
    })));
    return;
```

Note: `redactForRestrictedAgentView` must preserve `id` and `runtimeConfig` for this to work — it does (the cadence readout on the list already relies on `runtimeConfig`). If a restricted view strips `runtimeConfig`, `parseWipLimitConfig` still falls back to disabled defaults, so the count/flow remain correct and `wip.limit` is `null`.

- [ ] **Step 8: Run both route tests to verify they pass**

Run: `pnpm --filter @paperclipai/server test -- agents-wip-flow`
Expected: PASS (both files).

- [ ] **Step 9: Commit**

```bash
git add server/src/routes/agents.ts server/src/__tests__/agents-wip-flow-read.test.ts server/src/__tests__/agents-wip-flow-list.test.ts
git commit -m "feat(routes): expose wip status + flow metrics on agent read/list"
```

---

### Task 5: Shared Agent type + `AgentWipReadout` + Agents-page wiring

**Files:**
- Modify: `packages/shared/src/types/agent.ts` (add optional `wip`/`flow` to `Agent`)
- Create: `ui/src/components/AgentWipReadout.tsx`
- Test: `ui/src/components/AgentWipReadout.test.tsx`
- Modify: `ui/src/pages/Agents.tsx` (render the readout next to `AgentCadenceReadout` at `:529`)

**Interfaces:**
- Consumes: the route `wip`/`flow` fields (Task 4).
- Produces: `AgentWipStatus`, `AgentFlowMetrics` types on `Agent`; `AgentWipReadout` component; `getWipReadoutProps(agent)` in Agents.tsx.

- [ ] **Step 1: Add optional fields to the shared Agent type**

In `packages/shared/src/types/agent.ts`, before `metadata` (`:120`) in `interface Agent`:

```ts
  /** Combo-01 Phase 4A-ii: in-progress load vs limit (read-only; set by the read path). */
  wip?: { limit: number | null; current: number; overBy: number; overLimit: boolean };
  /** Combo-01 Phase 4A-ii: trailing-7d flow metrics (read-only; set by the read path). */
  flow?: { throughputLast7d: number; medianCycleTimeMs: number | null };
```

Build shared: `pnpm --filter @paperclipai/shared build` — expected exit 0.

- [ ] **Step 2: Write the failing component test**

Create `ui/src/components/AgentWipReadout.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentWipReadout } from "./AgentWipReadout";

describe("AgentWipReadout", () => {
  it("shows the count with a limit and no warning when under", () => {
    render(<AgentWipReadout wip={{ limit: 3, current: 2, overBy: 0, overLimit: false }} flow={{ throughputLast7d: 4, medianCycleTimeMs: 7200000 }} />);
    expect(screen.getByText(/WIP 2 \/ 3/)).toBeInTheDocument();
    expect(screen.queryByText("⚠")).not.toBeInTheDocument();
  });
  it("warns when over the limit", () => {
    render(<AgentWipReadout wip={{ limit: 3, current: 5, overBy: 2, overLimit: true }} flow={{ throughputLast7d: 0, medianCycleTimeMs: null }} />);
    expect(screen.getByText(/WIP 5 \/ 3/)).toBeInTheDocument();
    expect(screen.getByText(/⚠/)).toBeInTheDocument();
  });
  it("shows only the count when there is no limit", () => {
    render(<AgentWipReadout wip={{ limit: null, current: 1, overBy: 0, overLimit: false }} flow={{ throughputLast7d: 0, medianCycleTimeMs: null }} />);
    expect(screen.getByText(/WIP 1\b/)).toBeInTheDocument();
    expect(screen.queryByText(/\//)).not.toBeInTheDocument();
  });
  it("renders an em dash for a null median cycle time", () => {
    render(<AgentWipReadout wip={{ limit: null, current: 0, overBy: 0, overLimit: false }} flow={{ throughputLast7d: 0, medianCycleTimeMs: null }} />);
    expect(screen.getByText(/—/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @paperclipai/ui test -- AgentWipReadout`
Expected: FAIL — cannot find `./AgentWipReadout`.

- [ ] **Step 4: Create the component**

Create `ui/src/components/AgentWipReadout.tsx` (mirrors `AgentCadenceReadout.tsx`):

```tsx
import { formatDurationMs } from "../lib/utils";

export interface AgentWipReadoutProps {
  wip: { limit: number | null; current: number; overBy: number; overLimit: boolean };
  flow: { throughputLast7d: number; medianCycleTimeMs: number | null };
}

/**
 * Compact per-agent WIP + flow readout. Shows in-progress load against the
 * configured limit (with a warning when over), plus trailing-7d throughput and
 * median cycle time. Agents without a limit read `WIP N` with no cap; the
 * limit/warning only appears once an operator opts in (Combo-01 Phase 4A-ii).
 */
export function AgentWipReadout({ wip, flow }: AgentWipReadoutProps) {
  const cycle = flow.medianCycleTimeMs === null ? "—" : formatDurationMs(flow.medianCycleTimeMs);
  const load = wip.limit === null ? `WIP ${wip.current}` : `WIP ${wip.current} / ${wip.limit}`;
  return (
    <span className={`text-xs ${wip.overLimit ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"}`}>
      {load}{wip.overLimit ? " ⚠" : ""} · {flow.throughputLast7d}/wk · {cycle}
    </span>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @paperclipai/ui test -- AgentWipReadout`
Expected: PASS.

- [ ] **Step 6: Wire it into the Agents page**

In `ui/src/pages/Agents.tsx`, add a props helper next to `getCadenceReadoutProps` (`:77`):

```ts
function getWipReadoutProps(agent: Agent) {
  return {
    wip: agent.wip ?? { limit: null, current: 0, overBy: 0, overLimit: false },
    flow: agent.flow ?? { throughputLast7d: 0, medianCycleTimeMs: null },
  };
}
```

Import the component with the other component imports:

```ts
import { AgentWipReadout } from "../components/AgentWipReadout";
```

Render it directly under the cadence readout (`:529`):

```tsx
        <div className="whitespace-nowrap">
          <AgentCadenceReadout {...getCadenceReadoutProps(agent)} />
        </div>
        <div className="whitespace-nowrap">
          <AgentWipReadout {...getWipReadoutProps(agent)} />
        </div>
```

- [ ] **Step 7: Run the Agents-page tests to verify nothing regressed**

Run: `pnpm --filter @paperclipai/ui test -- Agents`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types/agent.ts ui/src/components/AgentWipReadout.tsx ui/src/components/AgentWipReadout.test.tsx ui/src/pages/Agents.tsx
git commit -m "feat(ui): agent WIP + flow readout on the agents list"
```

---

### Task 6: WIP limit controls in the agent config form

**Files:**
- Modify: `ui/src/components/agent-config-primitives.tsx` (add two `help` hint strings)
- Modify: `ui/src/components/AgentConfigForm.tsx` (derive WIP config + `updateWipLimit`; render controls in the Phase-4A heartbeat block)
- Test: `ui/src/components/AgentConfigForm.test.tsx` (add a case, or create if absent)

**Interfaces:**
- Consumes: the `mark("heartbeat", "wipLimit", …)` patch mechanism already used for `idleBackoff`.
- Produces: config edits that write `runtimeConfig.heartbeat.wipLimit = { enabled, maxInProgress }`.

- [ ] **Step 1: Write the failing test**

Add to `ui/src/components/AgentConfigForm.test.tsx` (mirror how an existing test asserts an idle-backoff edit; the exact harness/prop names come from that file):

```tsx
it("emits a wipLimit patch when the WIP toggle is enabled", async () => {
  const onChange = vi.fn();
  renderAgentConfigForm({ onChange }); // existing test helper in this file
  await userEvent.click(screen.getByLabelText(/WIP limit/i));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      runtimeConfig: expect.objectContaining({
        heartbeat: expect.objectContaining({
          wipLimit: expect.objectContaining({ enabled: true, maxInProgress: 3 }),
        }),
      }),
    }),
  );
});
```

If `AgentConfigForm.test.tsx` does not exist, create it modeled on the nearest existing form test (`ui/src/lib/agent-config-patch.test.ts` shows the patch shape) and render the component with minimal props.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @paperclipai/ui test -- AgentConfigForm`
Expected: FAIL — no `WIP limit` control exists.

- [ ] **Step 3: Add help hints**

In `ui/src/components/agent-config-primitives.tsx`, next to `idleBackoffEnabled` (`:77`):

```ts
  wipLimitEnabled: "Warn when this agent has more issues in progress at once than the limit below. This is a visibility signal only — it does not stop the agent from starting new work.",
  wipLimitMaxInProgress: "The number of in-progress issues at which this agent is flagged as over its WIP limit.",
```

- [ ] **Step 4: Derive WIP config in the form**

In `ui/src/components/AgentConfigForm.tsx`, after the `updateIdleBackoff` block (`:805-811`):

```ts
  // Combo-01 Phase 4A-ii: WIP limit — warn when in-progress load exceeds the cap.
  // Disabled by default; observability only, no gating.
  const wipLimit = asObject(effectiveHeartbeat.wipLimit);
  const wipLimitEnabled = asBoolean(wipLimit.enabled, false);
  const wipLimitMaxInProgress = asFiniteNumber(wipLimit.maxInProgress, 3);

  function updateWipLimit(patch: Record<string, unknown>) {
    mark("heartbeat", "wipLimit", {
      enabled: wipLimitEnabled,
      maxInProgress: wipLimitMaxInProgress,
      ...patch,
    });
  }
```

- [ ] **Step 5: Render the controls**

In the heartbeat Phase-4A section, after the idle-backoff bordered block (`:1449-1480`), add a sibling block:

```tsx
              <div className="rounded-md border border-border/70 px-3 py-2">
                <ToggleField
                  label="WIP limit"
                  hint={help.wipLimitEnabled}
                  checked={wipLimitEnabled}
                  onChange={(v) => updateWipLimit({ enabled: v })}
                />
                {wipLimitEnabled ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Max in progress" hint={help.wipLimitMaxInProgress}>
                      <DraftNumberInput
                        value={wipLimitMaxInProgress}
                        onCommit={(v) => updateWipLimit({ maxInProgress: Math.max(1, Math.round(v)) })}
                        min={1}
                        step={1}
                        immediate
                        className={inputClass}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @paperclipai/ui test -- AgentConfigForm`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/src/components/agent-config-primitives.tsx ui/src/components/AgentConfigForm.tsx ui/src/components/AgentConfigForm.test.tsx
git commit -m "feat(ui): per-agent WIP limit controls in the agent config form"
```

---

### Task 7: Full typecheck + suite green

**Files:** none (verification task)

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm -w typecheck` (or `pnpm -r typecheck`)
Expected: exits 0 — the new shared `wip`/`flow` fields and route return shapes typecheck.

- [ ] **Step 2: Run the server + shared + ui suites for touched areas**

Run: `pnpm --filter @paperclipai/shared test -- agent-heartbeat && pnpm --filter @paperclipai/server test -- "wip-flow|issues-wip-flow|agents-wip-flow" && pnpm --filter @paperclipai/ui test -- "AgentWipReadout|AgentConfigForm|Agents"`
Expected: all PASS (embedded-postgres suite may SKIP).

- [ ] **Step 3: Commit any incidental fixes, then verify the branch**

```bash
git status
git log --oneline master..HEAD
```

Expected: seven feature commits (Tasks 1–6 plus any fix), all tests green.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-12-wip-limits-flow-control-design.md`):
- Config schema (spec §Architecture 1) → Task 1.
- Pure module `wip-flow.ts` — `parseWipLimitConfig`/`wipStatus`/`computeFlowMetrics` (spec §Architecture 2) → Task 2.
- Grouped in-progress + recent-completion queries, list-safe (spec §Architecture 3, §decision 4) → Task 3 (impl) + Task 4 (once-per-request wiring, asserted by the list test's `toHaveBeenCalledTimes(1)`).
- `wip`/`flow` on agent read + list (spec §Architecture 4) → Task 4.
- `AgentWipReadout` + Agents-page wiring (spec §Architecture 5, readout) → Task 5.
- Config controls in `AgentConfigForm` (spec §Architecture 5, controls) → Task 6.
- Opt-in default / disabled ⇒ `limit:null`, never over (spec §decision 2) → Task 1 schema default + Task 2 `wipStatus` disabled branch (tested).
- "In progress" = `in_progress` only (spec §decision 3) → Task 3 query `eq(status,"in_progress")`.
- Null median on empty window (spec §decision 6) → Task 2 test + Task 5 em-dash render.
- No gate (spec §Scope Out) → no task touches `startNextQueuedRunForAgent`/selection/checkout.
- Graceful metric degradation (spec §Error handling) → Task 4 note: absent `runtimeConfig` falls back to disabled defaults.

**Placeholder scan:** none — every code step shows complete code; test steps show assertions. The two route-test tasks say "copy the cadence harness then make these edits," which references a concrete existing file and lists the exact mock methods + assertions to add.

**Type consistency:** `WipStatus`/`FlowMetrics`/`WipFlowFields` names and shapes are identical across Task 2 (definition), Task 4 (route return), and Task 5 (shared `Agent.wip`/`Agent.flow` inline shapes match field-for-field). Method names `inProgressIssueCountsByAgent` / `recentCompletionsByAgent` are identical in Task 3 (impl), Task 4 (route calls + mocks). Config path `runtimeConfig.heartbeat.wipLimit` and fields `enabled`/`maxInProgress` are identical across Tasks 1, 2, 6.

**One residual to confirm during Task 4:** whether `redactForRestrictedAgentView` preserves `id`/`runtimeConfig`. The plan handles both outcomes (fields preserved ⇒ correct; stripped ⇒ safe disabled-default fallback), so no task is blocked.
