/**
 * FILE: server/src/__tests__/heartbeat-path-claim-release.test.ts
 * ABOUT: heartbeat-path-claim-release.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - heartbeat-path-claim-release.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: heartbeat-path-claim-release.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/heartbeat-path-claim-release.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agentRuntimeState,
  agents,
  agentTaskSessions,
  agentWakeupRequests,
  companies,
  companySkills,
  createDb,
  documentRevisions,
  documents,
  executionWorkspaces,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issueDocuments,
  issues,
  projects,
  projectWorkspaces,
  workspaceOperations,
  workspacePathClaims,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { workspacePathClaimService } from "../services/workspace-path-claims.ts";

const execFileAsync = promisify(execFile);

async function createGitRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "paperclip-heartbeat-path-claim-release-repo-"));
  await execFileAsync("git", ["init"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.email", "paperclip-test@example.com"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.name", "Paperclip Test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "README.md"), "path claim release test\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: repoRoot });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: repoRoot });
  return repoRoot;
}

// The adapter mock simulates an agent that has acquired a workspace path
// claim mid-run (as it would via the real acquire-claim route while doing
// its work). This lets us assert that heartbeat's executeRun `finally`
// releases any claims still held by the run once it reaches a terminal
// state, without needing to drive the actual HTTP claim route.
let claimSeeder: ((runId: string) => Promise<void>) | null = null;

const adapterExecute = vi.hoisted(() => vi.fn(async () => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  sessionParams: { sessionId: "session-1" },
  sessionDisplayId: "session-1",
  summary: "Path claim release test run.",
  provider: "test",
  model: "test-model",
})));

vi.mock("../adapters/index.js", () => ({
  getServerAdapter: () => ({
    type: "codex_local",
    execute: adapterExecute,
    supportsLocalAgentJwt: false,
  }),
  listAdapterModelProfiles: async () => [],
  runningProcesses: new Map(),
}));

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat path-claim release tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat releases workspace path claims on run end", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const tempRoots: string[] = [];

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-path-claim-release-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    adapterExecute.mockClear();
    claimSeeder = null;
    let idlePolls = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const runs = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns);
      const hasActiveRun = runs.some((run) => run.status === "queued" || run.status === "running");
      if (!hasActiveRun) {
        idlePolls += 1;
        if (idlePolls >= 5) break;
      } else {
        idlePolls = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
    await db.delete(activityLog);
    await db.delete(workspacePathClaims);
    await db.delete(workspaceOperations);
    await db.delete(heartbeatRunEvents);
    await db.delete(agentTaskSessions);
    await db.delete(heartbeatRuns);
    await db.delete(issueComments);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(agentWakeupRequests);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companySkills);
    await db.delete(companies);
  });

  afterAll(async () => {
    await db.$client.end();
    await tempDb?.cleanup();
  });

  async function seedBase() {
    const companyId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const agentId = randomUUID();
    const workspaceRoot = await createGitRepo();
    tempRoots.push(workspaceRoot);

    await db.insert(companies).values({
      id: companyId,
      name: "Acme",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      status: "active",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Path Claim Release",
      status: "active",
    });
    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      companyId,
      projectId,
      name: "Primary",
      cwd: workspaceRoot,
      isPrimary: true,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    return { companyId, projectId, projectWorkspaceId, agentId, workspaceRoot };
  }

  async function seedWorkspace(args: { companyId: string; projectId: string; projectWorkspaceId: string; workspaceRoot: string }) {
    const executionWorkspaceId = randomUUID();
    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      companyId: args.companyId,
      projectId: args.projectId,
      projectWorkspaceId: args.projectWorkspaceId,
      mode: "shared_workspace",
      strategyType: "project_primary",
      name: "Shared workspace",
      status: "active",
      cwd: args.workspaceRoot,
      providerType: "local_fs",
      providerRef: args.workspaceRoot,
    });
    return executionWorkspaceId;
  }

  async function seedIssue(args: {
    companyId: string;
    projectId: string;
    projectWorkspaceId: string;
    agentId: string;
    executionWorkspaceId: string;
  }) {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId: args.companyId,
      projectId: args.projectId,
      projectWorkspaceId: args.projectWorkspaceId,
      title: "Path claim release",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: args.agentId,
      executionWorkspaceId: args.executionWorkspaceId,
      executionWorkspaceSettings: { mode: "shared_workspace" },
    });
    return issueId;
  }

  it("releases active workspace path claims once the run reaches a terminal state", async () => {
    const { companyId, projectId, projectWorkspaceId, agentId, workspaceRoot } = await seedBase();
    const executionWorkspaceId = await seedWorkspace({ companyId, projectId, projectWorkspaceId, workspaceRoot });
    const issueId = await seedIssue({ companyId, projectId, projectWorkspaceId, agentId, executionWorkspaceId });

    const pathClaims = workspacePathClaimService(db);

    // Simulate the agent acquiring a path claim mid-run (as it would via the
    // real acquire-claim HTTP route while doing its work) by seeding it from
    // inside the mocked adapter's execute call, which receives the real runId
    // assigned by heartbeat before the run's finally block ever runs.
    claimSeeder = async (runId: string) => {
      await pathClaims.acquireClaim({
        companyId,
        executionWorkspaceId,
        heartbeatRunId: runId,
        agentId,
        path: "src/",
      });
    };
    adapterExecute.mockImplementation(async (input: { runId: string }) => {
      await claimSeeder?.(input.runId);
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        sessionParams: { sessionId: "session-1" },
        sessionDisplayId: "session-1",
        summary: "Path claim release test run.",
        provider: "test",
        model: "test-model",
      };
    });

    const heartbeat = heartbeatService(db);
    const run = await heartbeat.wakeup(agentId, {
      source: "assignment",
      triggerDetail: "manual",
      contextSnapshot: { issueId },
    });

    expect(run).not.toBeNull();
    await vi.waitFor(async () => {
      const latest = await heartbeat.getRun(run!.id);
      expect(latest?.status).toBe("succeeded");
    }, { timeout: 10_000 });

    // The run reaching a terminal status (visible above) and its executeRun
    // `finally` block finishing teardown (which releases path claims) are two
    // separate moments — there's a small window between them, and a
    // continuation run may also get auto-queued for the same agent/issue.
    // Wait for the whole agent to go fully idle (no queued/running heartbeat
    // runs, for several consecutive polls) before asserting on claim state,
    // the same debounced pattern this suite's afterEach uses before teardown.
    await vi.waitFor(async () => {
      let idlePolls = 0;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const runs = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns);
        const hasActiveRun = runs.some((r) => r.status === "queued" || r.status === "running");
        if (!hasActiveRun) {
          idlePolls += 1;
          if (idlePolls >= 5) return;
        } else {
          idlePolls = 0;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("heartbeat runs never went idle");
    }, { timeout: 10_000 });

    // The run held an active claim mid-execution...
    const claimsForRun = await db
      .select()
      .from(workspacePathClaims)
      .where(eq(workspacePathClaims.heartbeatRunId, run!.id));
    expect(claimsForRun).toHaveLength(1);

    // ...but by the time the run's teardown finally block has run, the claim
    // must be released, not left dangling as active.
    expect(claimsForRun[0]?.status).toBe("released");
    expect(claimsForRun[0]?.releasedAt).not.toBeNull();

    const activeClaims = await pathClaims.listActiveClaimsOnWorkspace(executionWorkspaceId);
    expect(activeClaims).toHaveLength(0);
  }, 20_000);
});
// [END: module]
