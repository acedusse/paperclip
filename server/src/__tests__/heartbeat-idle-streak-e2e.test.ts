/**
 * FILE: server/src/__tests__/heartbeat-idle-streak-e2e.test.ts
 * ABOUT: Combo-01 Phase 4A - end-to-end lock of the timer wakeReason -> idle-streak chain.
 *
 * SECTIONS:
 *   [TAG: module] - heartbeat-idle-streak-e2e.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: Drive a real tickTimers() timer wake through to run completion against an embedded
//   Postgres database and prove the full chain end-to-end: tickTimers enqueues a wake with
//   reason "heartbeat_timer" -> enrichWakeContextSnapshot persists contextSnapshot.wakeReason
//   on the run -> at completion the run's contextSnapshot is re-parsed and wakeReason is read
//   back out -> applyIdleStreakUpdate (gated on idleBackoff.enabled) is called with the run's
//   actual outcome/livenessState and updates agents.heartbeat_idle_streak. Unlike the unit test
//   (heartbeat-idle-streak.test.ts, which calls applyIdleStreakUpdate directly) and the tick
//   test (heartbeat-idle-backoff-tick.test.ts, which only asserts the synchronous `enqueued`
//   count), this test never calls applyIdleStreakUpdate directly and never asserts on
//   `enqueued` alone for the completion outcome - it drains the fire-and-forget executeRun(...)
//   to a terminal status and reads back the persisted row, so a future refactor that silently
//   breaks the wakeReason plumbing (e.g. renaming `context`, or changing what
//   enqueueWakeup/enrichWakeContextSnapshot persist onto contextSnapshot) would fail this test
//   even though it wouldn't be caught by either of those narrower tests.
// JSON_FLOW: {"file": "server/src/__tests__/heartbeat-idle-streak-e2e.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { agents, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import type { RunLivenessState } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";
import { parseObject } from "../adapters/utils.js";
import { isEmptyTimerHeartbeat, nextIdleStreak } from "../services/heartbeat-cadence.js";

// tickTimers's enqueued wake fires executeRun(...) in the background (fire-and-forget). We stub
// the adapter so the run completes fast with a benign success and no real process ever spawns.
const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Idle-streak e2e test run.",
    provider: "test",
    model: "test-model",
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat idle-streak e2e tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat idle streak e2e (timer wakeReason -> idle streak)", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  const now = new Date("2026-07-12T00:00:00.000Z");

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  const setup = async () => {
    if (!tempDb) {
      tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-idle-streak-e2e-");
      db = createDb(tempDb.connectionString);
      heartbeat = heartbeatService(db);
    }
  };

  const teardown = async () => {
    if (!db) return;
    // Drain any fire-and-forget executeRun(...) aftermath before deleting rows so a
    // still-running background write can't race a delete of its own parent row.
    let idlePolls = 0;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const rows = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns);
      const hasActiveRun = rows.some((run) => run.status === "queued" || run.status === "running");
      if (!hasActiveRun) {
        idlePolls += 1;
        if (idlePolls >= 3) break;
      } else {
        idlePolls = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    runningProcesses.clear();
    // heartbeat_runs and agent_wakeup_requests reference each other (wakeup_request_id /
    // run_id), so a plain per-table DELETE order can never satisfy both FKs at once.
    // TRUNCATE ... CASCADE in a single statement sidesteps the cycle entirely. Retry to
    // absorb any last-moment child-row write from a fire-and-forget run still finishing.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await db.execute(sql.raw(`
          TRUNCATE TABLE
            "company_skills",
            "environment_leases",
            "activity_log",
            "heartbeat_run_events",
            "agent_wakeup_requests",
            "workspace_operations",
            "execution_workspaces",
            "agent_runtime_state",
            "heartbeat_runs",
            "agents",
            "companies"
          RESTART IDENTITY CASCADE
        `));
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  };

  // Seeds exactly one active, invokable agent (active company, no manager => valid org
  // chain, heartbeat enabled) that is due for a timer wake right now.
  async function seedDueAgent(opts: { idleBackoffEnabled: boolean; streak: number }) {
    await setup();
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "IdleStreakE2EAgent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          enabled: true,
          intervalSec: 60,
          idleBackoff: {
            enabled: opts.idleBackoffEnabled,
            multiplier: 2,
            maxIntervalSec: 3600,
          },
        },
      },
      permissions: {},
      heartbeatIdleStreak: opts.streak,
      // Far enough in the past that the agent is due at `now` regardless of idle backoff.
      lastHeartbeatAt: new Date(now.getTime() - 10_000_000),
    });
    return { companyId, agentId };
  }

  // Polls the specific run row (not just "any row" like the teardown drain) until it leaves
  // queued/running, i.e. until executeRun's fire-and-forget completion path has finished
  // persisting the terminal status + contextSnapshot + liveness fields.
  //
  // The status flip (setRunStatusIfRunning) and the livenessState write
  // (classifyAndPersistRunLiveness) are two SEPARATE sequential UPDATEs inside the same
  // completion path, executed before applyIdleStreakUpdate is called. A poll can therefore
  // observe the row in the narrow window after status has gone terminal but before
  // livenessState has been persisted, which would read back a livenessState that the real
  // call site never saw. Require a few consecutive stable reads (same debounce shape as the
  // shared teardown's drain) before trusting the row.
  async function drainRunToTerminal(runId: string) {
    let stablePolls = 0;
    let lastRow: typeof heartbeatRuns.$inferSelect | undefined;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const [row] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
      if (row && row.status !== "queued" && row.status !== "running") {
        stablePolls += 1;
        lastRow = row;
        if (stablePolls >= 4) return row;
      } else {
        stablePolls = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (lastRow) return lastRow;
    throw new Error(`heartbeat run ${runId} did not reach a terminal status within the drain budget`);
  }

  it("persists wakeReason=heartbeat_timer through to completion and moves the idle streak exactly as the pure logic dictates", async () => {
    const { agentId } = await seedDueAgent({ idleBackoffEnabled: true, streak: 0 });
    try {
      const result = await heartbeat.tickTimers(now);
      expect(result.enqueued).toBe(1);

      const [queuedRun] = await db
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.agentId, agentId));
      expect(queuedRun).toBeTruthy();

      const run = await drainRunToTerminal(queuedRun.id);

      // The linchpin: the timer marker survived enqueue -> persistence -> re-parse at
      // completion. If a refactor renamed `context`/`wakeReason` or changed what
      // enrichWakeContextSnapshot writes, this would be the first thing to break.
      const context = parseObject(run.contextSnapshot);
      const wakeReason = context.wakeReason as string | null;
      expect(wakeReason).toBe("heartbeat_timer");
      expect(run.status).toBe("succeeded");

      const [agentRow] = await db.select().from(agents).where(eq(agents.id, agentId));

      // Deterministic streak assertion robust to whatever livenessState the benign mock
      // produced: compute the expected streak from the REAL persisted run fields (not a
      // hardcoded liveness value) and assert the column matches exactly. This locks both
      // the wakeReason extraction AND the gated applyIdleStreakUpdate call site, regardless
      // of which livenessState classification the mock's success actually yields.
      const expected = nextIdleStreak(
        0,
        isEmptyTimerHeartbeat({
          wakeReason,
          outcome: "succeeded",
          livenessState: run.livenessState as RunLivenessState | null,
        }),
      );
      expect(agentRow.heartbeatIdleStreak).toBe(expected);
    } finally {
      await teardown();
    }
  });

  it("with idle backoff disabled, a completed timer run never accrues the idle streak (b2180af guard, e2e)", async () => {
    const { agentId } = await seedDueAgent({ idleBackoffEnabled: false, streak: 0 });
    try {
      const result = await heartbeat.tickTimers(now);
      expect(result.enqueued).toBe(1);

      const [queuedRun] = await db
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.agentId, agentId));
      expect(queuedRun).toBeTruthy();

      const run = await drainRunToTerminal(queuedRun.id);

      // Still confirm the wakeReason plumbing fired even though the streak update is gated off.
      const context = parseObject(run.contextSnapshot);
      expect(context.wakeReason).toBe("heartbeat_timer");

      const [agentRow] = await db.select().from(agents).where(eq(agents.id, agentId));
      // Disabled agents accrue nothing, regardless of the run's outcome/livenessState.
      expect(agentRow.heartbeatIdleStreak).toBe(0);
    } finally {
      await teardown();
    }
  });
});
// [END: module]
