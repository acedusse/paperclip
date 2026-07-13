import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { createDb, companies, agents, projects, executionWorkspaces, heartbeatRuns, workspaceOperations } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { workspaceOperationService } from "../services/workspace-operations.ts";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(
    `Skipping embedded Postgres workspace-operations concurrency tests on this host: ${support.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("workspaceOperationService.runningRunIdsOnWorkspace", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof workspaceOperationService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-wsop-concurrency-");
    db = createDb(tempDb.connectionString);
    svc = workspaceOperationService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(workspaceOperations);
    await db.delete(heartbeatRuns);
    await db.delete(executionWorkspaces);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => { await tempDb?.cleanup(); });

  async function seed() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const projectId = randomUUID();
    const wsA = randomUUID();
    const wsB = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "P", issuePrefix: "WSC1", requireBoardApprovalForNewAgents: false });
    await db.insert(agents).values({ id: agentId, companyId, name: "A" });
    await db.insert(projects).values({ id: projectId, companyId, name: "Workspace concurrency project" });
    await db.insert(executionWorkspaces).values([
      { id: wsA, companyId, projectId, mode: "shared_workspace", strategyType: "shared", name: "WS A", status: "active", cwd: "/tmp/a" },
      { id: wsB, companyId, projectId, mode: "shared_workspace", strategyType: "shared", name: "WS B", status: "active", cwd: "/tmp/b" },
    ]);
    return { companyId, agentId, wsA, wsB };
  }

  async function seedRun(companyId: string, agentId: string, status: string) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status });
    return runId;
  }

  async function seedOp(companyId: string, runId: string, workspaceId: string) {
    await db.insert(workspaceOperations).values({
      id: randomUUID(), companyId, heartbeatRunId: runId, executionWorkspaceId: workspaceId,
      phase: "workspace_provision", status: "running", startedAt: new Date(),
    });
  }

  it("returns other running runs with an op-log row on the same workspace, excluding self", async () => {
    const { companyId, agentId, wsA } = await seed();
    const runSelf = await seedRun(companyId, agentId, "running");
    const runPeer = await seedRun(companyId, agentId, "running");
    await seedOp(companyId, runSelf, wsA);
    await seedOp(companyId, runPeer, wsA);
    expect(await svc.runningRunIdsOnWorkspace(wsA, runSelf)).toEqual([runPeer]);
  });

  it("excludes runs whose op-log row is on a different workspace", async () => {
    const { companyId, agentId, wsA, wsB } = await seed();
    const runSelf = await seedRun(companyId, agentId, "running");
    const runOther = await seedRun(companyId, agentId, "running");
    await seedOp(companyId, runSelf, wsA);
    await seedOp(companyId, runOther, wsB);
    expect(await svc.runningRunIdsOnWorkspace(wsA, runSelf)).toEqual([]);
  });

  it("excludes runs that are not running", async () => {
    const { companyId, agentId, wsA } = await seed();
    const runSelf = await seedRun(companyId, agentId, "running");
    const runDone = await seedRun(companyId, agentId, "succeeded");
    await seedOp(companyId, runSelf, wsA);
    await seedOp(companyId, runDone, wsA);
    expect(await svc.runningRunIdsOnWorkspace(wsA, runSelf)).toEqual([]);
  });

  it("dedups multiple op-log rows for the same peer run on the same workspace", async () => {
    const { companyId, agentId, wsA } = await seed();
    const runSelf = await seedRun(companyId, agentId, "running");
    const runPeer = await seedRun(companyId, agentId, "running");
    await seedOp(companyId, runSelf, wsA);
    // Two workspace_operations rows for the SAME peer run on the SAME workspace
    // (e.g. multiple phases logged for one run) must still count as one run.
    await seedOp(companyId, runPeer, wsA);
    await seedOp(companyId, runPeer, wsA);
    expect(await svc.runningRunIdsOnWorkspace(wsA, runSelf)).toEqual([runPeer]);
  });
});
