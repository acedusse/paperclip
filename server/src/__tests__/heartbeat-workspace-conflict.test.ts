/**
 * FILE: server/src/__tests__/heartbeat-workspace-conflict.test.ts
 * ABOUT: heartbeat-workspace-conflict.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - heartbeat-workspace-conflict.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: heartbeat-workspace-conflict.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/heartbeat-workspace-conflict.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
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
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";

const execFileAsync = promisify(execFile);

async function createGitRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "paperclip-heartbeat-workspace-conflict-repo-"));
  await execFileAsync("git", ["init"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.email", "paperclip-test@example.com"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.name", "Paperclip Test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "README.md"), "workspace conflict detection\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: repoRoot });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: repoRoot });
  return repoRoot;
}

const adapterExecute = vi.hoisted(() => vi.fn(async () => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  sessionParams: { sessionId: "session-1" },
  sessionDisplayId: "session-1",
  summary: "Workspace conflict detection test run.",
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
    `Skipping embedded Postgres heartbeat workspace-conflict tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat concurrent shared-workspace detection", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const tempRoots: string[] = [];

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-workspace-conflict-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    adapterExecute.mockClear();
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
    const peerAgentId = randomUUID();
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
      name: "Workspace Conflict Detection",
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
    await db.insert(agents).values([
      {
        id: agentId,
        companyId,
        name: "CodexCoder",
        role: "engineer",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: peerAgentId,
        companyId,
        name: "PeerCoder",
        role: "engineer",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    return { companyId, projectId, projectWorkspaceId, agentId, peerAgentId, workspaceRoot };
  }

  async function seedSharedWorkspace(args: { companyId: string; projectId: string; projectWorkspaceId: string; workspaceRoot: string }) {
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
      title: "Concurrent shared workspace detection",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: args.agentId,
      executionWorkspaceId: args.executionWorkspaceId,
      executionWorkspaceSettings: { mode: "shared_workspace" },
    });
    return issueId;
  }

  async function seedPeerRunningOp(args: { companyId: string; agentId: string; executionWorkspaceId: string }) {
    const peerRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: peerRunId,
      companyId: args.companyId,
      agentId: args.agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
    });
    await db.insert(workspaceOperations).values({
      id: randomUUID(),
      companyId: args.companyId,
      heartbeatRunId: peerRunId,
      executionWorkspaceId: args.executionWorkspaceId,
      phase: "workspace_provision",
      status: "running",
      startedAt: new Date(),
    });
    return peerRunId;
  }

  it("audits exactly one workspace_concurrent_activity_detected row when a peer run is active in the same shared workspace", async () => {
    const { companyId, projectId, projectWorkspaceId, agentId, peerAgentId, workspaceRoot } = await seedBase();
    const executionWorkspaceId = await seedSharedWorkspace({ companyId, projectId, projectWorkspaceId, workspaceRoot });
    const issueId = await seedIssue({ companyId, projectId, projectWorkspaceId, agentId, executionWorkspaceId });
    const peerRunId = await seedPeerRunningOp({ companyId, agentId: peerAgentId, executionWorkspaceId });

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

    const audits = await db
      .select()
      .from(activityLog)
      .where(and(
        eq(activityLog.action, "workspace_concurrent_activity_detected"),
        eq(activityLog.entityId, executionWorkspaceId),
      ));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.entityType).toBe("execution_workspace");
    const details = audits[0]?.details as { concurrentRunIds: string[]; count: number };
    expect(details.concurrentRunIds).toContain(peerRunId);
    expect(details.count).toBe(1);
  }, 20_000);

  it("does not audit when the shared workspace has no other active run", async () => {
    const { companyId, projectId, projectWorkspaceId, agentId, workspaceRoot } = await seedBase();
    const executionWorkspaceId = await seedSharedWorkspace({ companyId, projectId, projectWorkspaceId, workspaceRoot });
    const issueId = await seedIssue({ companyId, projectId, projectWorkspaceId, agentId, executionWorkspaceId });

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

    const audits = await db
      .select()
      .from(activityLog)
      .where(and(
        eq(activityLog.action, "workspace_concurrent_activity_detected"),
        eq(activityLog.entityId, executionWorkspaceId),
      ));
    expect(audits).toHaveLength(0);
  }, 20_000);
});
// [END: module]
