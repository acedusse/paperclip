/**
 * FILE: server/src/__tests__/heartbeat-claim-aware-selection-tick.test.ts
 * ABOUT: Integration proof for the claim-aware defer gate inside
 * startNextQueuedRunForAgent's claim loop (Combo-01 Phase 4B slice 3). A "new
 * start" queued run (issue in a checkout-eligible status, here: todo) whose
 * execution workspace already carries a live path claim from a DIFFERENT
 * running run is deferred, while a "continuation" queued run (issue already
 * in_progress) targeting the same contended workspace is claimed regardless.
 * The gate is off by default and only activates when the instance-level
 * `workspaceClaimAwareScheduling` flag is set; a new start queued past the
 * claim TTL bound is admitted anyway (bounded-defer, no starvation).
 *
 * Harness mirrors heartbeat-wip-enforcement-tick.test.ts: embedded Postgres,
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
  executionWorkspaces,
  heartbeatRuns,
  issues,
  projects,
  workspacePathClaims,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { instanceSettingsService } from "../services/instance-settings.ts";
import { DEFAULT_CLAIM_TTL_MS } from "../services/workspace-path-claims.ts";
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
    summary: "Claim-aware selection tick test run.",
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
    `Skipping embedded Postgres heartbeat claim-aware selection tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat claim-aware gate in the claim loop", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-claim-aware-selection-");
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
    // sidesteps having to hand-order every dependent table for that. This also
    // covers workspace_path_claims and execution_workspaces, which reference
    // heartbeat_runs / companies and are therefore cascade-truncated even though
    // they aren't named explicitly below.
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
  // masks the claim-gate effect being tested; WIP is disabled so the sibling
  // WIP gate (proven separately in heartbeat-wip-enforcement-tick.test.ts)
  // never interferes with these assertions.
  async function createAgent(companyId: string): Promise<string> {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: `Agent-${agentId.slice(0, 8)}`,
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { maxConcurrentRuns: 20, wipLimit: { enabled: false, maxInProgress: 3 } } },
      permissions: {},
    });
    return agentId;
  }

  async function createProject(companyId: string): Promise<string> {
    const projectId = randomUUID();
    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Claim-Aware Selection",
      status: "active",
    });
    return projectId;
  }

  // A shared_workspace execution workspace: the kind whose active path claims
  // gate new-start admission for OTHER queued runs targeting the same workspace.
  async function createSharedWorkspace(companyId: string, projectId: string): Promise<string> {
    const executionWorkspaceId = randomUUID();
    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      companyId,
      projectId,
      mode: "shared_workspace",
      strategyType: "shared",
      name: "Shared workspace",
      status: "active",
      cwd: "/tmp/paperclip-claim-aware-selection-workspace",
    });
    return executionWorkspaceId;
  }

  // Seed an issue assigned to the agent, optionally attached to a shared
  // execution workspace. `todo` issues are "new starts" per
  // isNewStartIssueStatus; `in_progress` issues are continuations.
  async function createIssue(
    companyId: string,
    agentId: string,
    status: "todo" | "in_progress",
    executionWorkspaceId?: string,
  ): Promise<string> {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: `Issue ${issueId.slice(0, 8)}`,
      status,
      priority: "medium",
      assigneeAgentId: agentId,
      executionWorkspaceId: executionWorkspaceId ?? null,
    });
    return issueId;
  }

  // A queued run's contextSnapshot carries { issueId } so the claim loop can
  // resolve the referenced issue's status (new-start vs continuation) and
  // execution workspace. `createdAt` can be backdated to simulate a run that
  // has been queued past the claim-scheduling bound.
  async function createQueuedRun(
    companyId: string,
    agentId: string,
    issueId: string,
    createdAt?: Date,
  ): Promise<string> {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "queued",
      contextSnapshot: { issueId },
      ...(createdAt ? { createdAt } : {}),
    });
    return runId;
  }

  // A `running` sibling run holding an `active` path claim on the given
  // workspace, expiring well in the future — the "different run" that
  // contends with a queued new start targeting the same shared workspace.
  async function createActiveSiblingClaim(
    companyId: string,
    agentId: string,
    executionWorkspaceId: string,
  ): Promise<string> {
    const siblingRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: siblingRunId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      contextSnapshot: {},
    });
    await db.insert(workspacePathClaims).values({
      id: randomUUID(),
      companyId,
      executionWorkspaceId,
      heartbeatRunId: siblingRunId,
      agentId,
      path: "/tmp/paperclip-claim-aware-selection-workspace",
      status: "active",
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    return siblingRunId;
  }

  async function getRunStatus(runId: string): Promise<string> {
    const [row] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    return row.status;
  }

  // ---- scenario builders --------------------------------------------------

  async function seedContendedNewStart(opts: { flag: boolean; queuedAt?: Date }) {
    await instanceSettingsService(db).updateGeneral({ workspaceClaimAwareScheduling: opts.flag });

    const companyId = await createCompany();
    const agentId = await createAgent(companyId);
    const projectId = await createProject(companyId);
    const executionWorkspaceId = await createSharedWorkspace(companyId, projectId);
    await createActiveSiblingClaim(companyId, agentId, executionWorkspaceId);

    const newStartIssueId = await createIssue(companyId, agentId, "todo", executionWorkspaceId);
    const newStartRunId = await createQueuedRun(companyId, agentId, newStartIssueId, opts.queuedAt);

    return { companyId, agentId, executionWorkspaceId, newStartIssueId, newStartRunId };
  }

  async function seedContendedContinuation(opts: { flag: boolean }) {
    await instanceSettingsService(db).updateGeneral({ workspaceClaimAwareScheduling: opts.flag });

    const companyId = await createCompany();
    const agentId = await createAgent(companyId);
    const projectId = await createProject(companyId);
    const executionWorkspaceId = await createSharedWorkspace(companyId, projectId);
    await createActiveSiblingClaim(companyId, agentId, executionWorkspaceId);

    const continuationIssueId = await createIssue(companyId, agentId, "in_progress", executionWorkspaceId);
    const continuationRunId = await createQueuedRun(companyId, agentId, continuationIssueId);

    return { companyId, agentId, executionWorkspaceId, continuationIssueId, continuationRunId };
  }

  // ---- tests ------------------------------------------------------------------

  it("defers a new start when its shared workspace has a live claim from another run", async () => {
    const { agentId, newStartIssueId, newStartRunId } = await seedContendedNewStart({ flag: true });
    const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
    const ids = claimed.map((r) => r.id);
    expect(ids).not.toContain(newStartRunId);
    expect(await getRunStatus(newStartRunId)).toBe("queued");
    const audits = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.action, "issue.start_deferred_path_claim"), eq(activityLog.entityId, newStartIssueId)));
    expect(audits).toHaveLength(1);
  });

  it("admits a continuation into the same contended workspace", async () => {
    const { agentId, continuationRunId } = await seedContendedContinuation({ flag: true });
    const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
    expect(claimed.map((r) => r.id)).toContain(continuationRunId);
  });

  it("does not gate when the flag is off (byte-identical scheduling)", async () => {
    const { agentId, newStartRunId } = await seedContendedNewStart({ flag: false });
    const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
    expect(claimed.map((r) => r.id)).toContain(newStartRunId);
    const audits = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "issue.start_deferred_path_claim"));
    expect(audits).toHaveLength(0);
  });

  it("admits a new start once queued past the bound, with the despite audit", async () => {
    // createdAt older than DEFAULT_CLAIM_TTL_MS so queuedForMs > boundMs.
    const { agentId, newStartIssueId, newStartRunId } = await seedContendedNewStart({
      flag: true,
      queuedAt: new Date(Date.now() - (DEFAULT_CLAIM_TTL_MS + 60_000)),
    });
    const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
    expect(claimed.map((r) => r.id)).toContain(newStartRunId);
    const audits = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.action, "issue.start_admitted_despite_path_claim"), eq(activityLog.entityId, newStartIssueId)));
    expect(audits).toHaveLength(1);
  });
});
