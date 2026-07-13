/**
 * FILE: server/src/__tests__/heartbeat-wip-enforcement-tick.test.ts
 * ABOUT: Integration proof for the WIP gate inside startNextQueuedRunForAgent's
 * claim loop (Combo-01 Task 2). A "new start" queued run (issue in a
 * checkout-eligible status: todo/backlog/blocked) is deferred once the
 * agent's in-progress count has consumed its WIP budget, while a
 * "continuation" queued run (issue already in_progress) is claimed
 * regardless. Deferred new-starts are audited via activity_log
 * (`issue.start_deferred_wip_limit`) and left `queued` for a future sweep.
 *
 * Harness mirrors heartbeat-instance-admission.test.ts: embedded Postgres,
 * heartbeatService(db), and assertions on the SYNCHRONOUS return value of
 * startNextQueuedRunForAgent (the claim decision is fixed before the
 * fire-and-forget executeRun(...) runs, so these tests never depend on its
 * async aftermath). The adapter is mocked to a fast no-op success so
 * background execution can never spawn a process or emit error logs.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";

// Neutralize the fire-and-forget executeRun(...) that runs AFTER admission: replace
// the real adapter with a fast, side-effect-free success so background execution can
// never spawn a process or emit error logs. Admission itself (the claim decision) is
// asserted synchronously via the value returned from startNextQueuedRunForAgent, so
// these tests never depend on executeRun's async aftermath.
const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "WIP enforcement tick test run.",
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
    `Skipping embedded Postgres heartbeat WIP enforcement tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat WIP gate in the claim loop", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-wip-enforcement-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 20_000);

  afterEach(async () => {
    // Restore any spies before draining so background executeRun(...) calls resolve
    // normally, then wait for those fire-and-forget runs to finish so we never delete
    // rows out from under an in-flight run. Our queued runs carry real issueIds, so
    // (unlike the no-issueId admission suites) executeRun's completion path can write
    // issue comments / continuation-summary documents and even queue follow-up runs
    // with a populated wakeupRequestId — TRUNCATE ... CASCADE (mirroring
    // heartbeat-stale-queue-invalidation.test.ts's cleanupHeartbeatInvalidationFixture)
    // sidesteps having to hand-order every dependent table for that.
    vi.restoreAllMocks();
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
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await db.execute(sql.raw(`
          TRUNCATE TABLE
            "company_skills",
            "issue_comments",
            "issue_documents",
            "document_revisions",
            "documents",
            "issue_relations",
            "issue_tree_holds",
            "environment_leases",
            "workspace_operations",
            "execution_workspaces",
            "issues",
            "heartbeat_run_events",
            "cost_events",
            "activity_log",
            "heartbeat_runs",
            "agent_wakeup_requests",
            "agent_runtime_state",
            "agents",
            "companies"
          RESTART IDENTITY CASCADE
        `));
        break;
      } catch (err) {
        if (attempt >= 9) throw err;
        // Heartbeat completion can write issue-thread comments / follow-up runs shortly
        // after a run leaves queued/running; retry the truncate once those land.
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  // ---- fixtures --------------------------------------------------------------

  async function createCompany(): Promise<string> {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  // maxConcurrentRuns is set generously high so the compute-cap budget never
  // masks the WIP effect being tested; wipLimit is set per-test.
  async function createAgent(
    companyId: string,
    wipLimit: { enabled: boolean; maxInProgress: number },
  ): Promise<string> {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: `Agent-${agentId.slice(0, 8)}`,
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { maxConcurrentRuns: 20, wipLimit } },
      permissions: {},
    });
    return agentId;
  }

  // Seed an issue assigned to the agent at the given status. `inProgress` issues
  // (not necessarily referenced by any queued run) count toward the agent's
  // in-progress WIP load; `todo` issues are "new starts" per isNewStartIssueStatus.
  async function createIssue(
    companyId: string,
    agentId: string,
    status: "todo" | "in_progress",
  ): Promise<string> {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: `Issue ${issueId.slice(0, 8)}`,
      status,
      priority: "medium",
      assigneeAgentId: agentId,
    });
    return issueId;
  }

  // A queued run's contextSnapshot carries { issueId } so the claim loop can
  // resolve the referenced issue's status (new-start vs continuation).
  async function createQueuedRun(companyId: string, agentId: string, issueId: string): Promise<string> {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "queued",
      contextSnapshot: { issueId },
    });
    return runId;
  }

  async function getRunStatus(runId: string): Promise<string> {
    const [row] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    return row.status;
  }

  async function claimedIssueIds(claimed: Array<{ contextSnapshot: unknown }>): Promise<string[]> {
    return claimed
      .map((run) => (run.contextSnapshot as { issueId?: string } | null)?.issueId)
      .filter((issueId): issueId is string => Boolean(issueId));
  }

  // ---- tests ------------------------------------------------------------------

  it("defers a new-start but claims a continuation when the agent is at its WIP limit", async () => {
    const companyId = await createCompany();
    const agentId = await createAgent(companyId, { enabled: true, maxInProgress: 3 });

    // 3 in_progress issues assigned to the agent => currentInProgress = 3, limit = 3 => budget 0.
    await createIssue(companyId, agentId, "in_progress");
    await createIssue(companyId, agentId, "in_progress");
    const inProgressIssueId = await createIssue(companyId, agentId, "in_progress");

    // One queued run continuing that in_progress issue (not a new start).
    await createQueuedRun(companyId, agentId, inProgressIssueId);

    // One queued run starting a fresh todo issue (a new start).
    const todoIssueId = await createIssue(companyId, agentId, "todo");
    const todoRunId = await createQueuedRun(companyId, agentId, todoIssueId);

    const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
    const ids = await claimedIssueIds(claimed);

    expect(ids).toContain(inProgressIssueId); // continuation claimed
    expect(ids).not.toContain(todoIssueId); // new start deferred

    expect(await getRunStatus(todoRunId)).toBe("queued"); // deferred run still queued

    const audits = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.action, "issue.start_deferred_wip_limit"), eq(activityLog.entityId, todoIssueId)));
    expect(audits).toHaveLength(1);
  });

  it("with headroom of 1 (2 in_progress, limit 3), claims exactly one of two new-starts", async () => {
    const companyId = await createCompany();
    const agentId = await createAgent(companyId, { enabled: true, maxInProgress: 3 });

    // 2 in_progress issues assigned => currentInProgress = 2, limit = 3 => budget 1.
    await createIssue(companyId, agentId, "in_progress");
    await createIssue(companyId, agentId, "in_progress");

    const firstTodoIssueId = await createIssue(companyId, agentId, "todo");
    const secondTodoIssueId = await createIssue(companyId, agentId, "todo");
    await createQueuedRun(companyId, agentId, firstTodoIssueId);
    await createQueuedRun(companyId, agentId, secondTodoIssueId);

    const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
    const ids = await claimedIssueIds(claimed);
    const newStartsClaimed = ids.filter(
      (issueId) => issueId === firstTodoIssueId || issueId === secondTodoIssueId,
    ).length;

    expect(newStartsClaimed).toBe(1);
  });

  it("disabled agent: claims all queued runs regardless of in-progress count (parity), no audit", async () => {
    const companyId = await createCompany();
    const agentId = await createAgent(companyId, { enabled: false, maxInProgress: 3 });

    // 5 in_progress issues assigned; with WIP disabled this must not matter at all.
    for (let i = 0; i < 5; i += 1) {
      await createIssue(companyId, agentId, "in_progress");
    }

    const firstTodoIssueId = await createIssue(companyId, agentId, "todo");
    const secondTodoIssueId = await createIssue(companyId, agentId, "todo");
    await createQueuedRun(companyId, agentId, firstTodoIssueId);
    await createQueuedRun(companyId, agentId, secondTodoIssueId);

    const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
    expect(claimed.length).toBe(2);

    const audits = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "issue.start_deferred_wip_limit"));
    expect(audits).toHaveLength(0);
  });
});
