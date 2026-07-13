/**
 * FILE: server/src/__tests__/workspace-path-claims-routes.test.ts
 * ABOUT: workspace-path-claims-routes.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - workspace-path-claims-routes.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: workspace-path-claims-routes.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/workspace-path-claims-routes.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
import { errorHandler } from "../middleware/index.js";
import { workspacePathClaimRoutes } from "../routes/workspace-path-claims.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres workspace-path-claims route tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("workspace path claim routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-wspc-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(workspacePathClaims);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(executionWorkspaces);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp(actor: Express.Request["actor"]) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    app.use("/api", workspacePathClaimRoutes(db));
    app.use(errorHandler);
    return app;
  }

  function agentActor(companyId: string, agentId: string, runId: string): Express.Request["actor"] {
    return {
      type: "agent",
      agentId,
      companyId,
      runId,
      source: "agent_jwt",
    };
  }

  async function seedSharedWorkspaceRun() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const projectId = randomUUID();
    const wsId = randomUUID();
    const issueId = randomUUID();
    const runSelf = randomUUID();
    const runB = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(projects).values({ id: projectId, companyId, name: "Path claims project" });
    await db.insert(executionWorkspaces).values({
      id: wsId,
      companyId,
      projectId,
      mode: "shared_workspace",
      strategyType: "shared",
      name: "Shared WS",
      status: "active",
      cwd: "/tmp/shared",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Shared workspace issue",
      status: "in_progress",
      priority: "high",
      executionWorkspaceId: wsId,
    });
    await db.insert(heartbeatRuns).values([
      { id: runSelf, companyId, agentId, status: "running", contextSnapshot: { issueId } },
      { id: runB, companyId, agentId, status: "running", contextSnapshot: { issueId } },
    ]);

    return { companyId, agentId, projectId, wsId, issueId, runSelf, runB };
  }

  it("acquires a claim and reports + audits an overlapping peer claim", async () => {
    const { companyId, agentId, wsId, runSelf, runB } = await seedSharedWorkspaceRun();

    // Seed a peer run's active claim on an overlapping path.
    await db.insert(workspacePathClaims).values({
      id: randomUUID(),
      companyId,
      executionWorkspaceId: wsId,
      heartbeatRunId: runB,
      agentId,
      path: "src/pay",
      status: "active",
    });

    const res = await request(createApp(agentActor(companyId, agentId, runSelf)))
      .post(`/api/companies/${companyId}/workspace-path-claims`)
      .send({ path: "src/pay/api" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.claim.path).toBe("src/pay/api");
    expect(res.body.conflicts.map((c: { heartbeatRunId: string }) => c.heartbeatRunId)).toContain(runB);

    const audits = await db.select().from(activityLog).where(eq(activityLog.action, "workspace_path_claim_conflict"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      companyId,
      actorType: "agent",
      entityType: "execution_workspace",
      entityId: wsId,
      details: { path: "src/pay/api", conflictingRunIds: [runB] },
    });
  });

  it("rejects a claim when the run has no shared workspace", async () => {
    const { companyId, agentId, projectId, runSelf } = await seedSharedWorkspaceRun();

    // Point this run's issue at an isolated (non shared_workspace) workspace.
    const isolatedWsId = randomUUID();
    const isolatedIssueId = randomUUID();
    await db.insert(executionWorkspaces).values({
      id: isolatedWsId,
      companyId,
      projectId,
      mode: "isolated_workspace",
      strategyType: "isolated",
      name: "Isolated WS",
      status: "active",
      cwd: "/tmp/isolated",
    });
    await db.insert(issues).values({
      id: isolatedIssueId,
      companyId,
      title: "Isolated workspace issue",
      status: "in_progress",
      priority: "high",
      executionWorkspaceId: isolatedWsId,
    });
    await db
      .update(heartbeatRuns)
      .set({ contextSnapshot: { issueId: isolatedIssueId } })
      .where(eq(heartbeatRuns.id, runSelf));

    const res = await request(createApp(agentActor(companyId, agentId, runSelf)))
      .post(`/api/companies/${companyId}/workspace-path-claims`)
      .send({ path: "src/pay/api" });

    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(await db.select().from(workspacePathClaims)).toHaveLength(0);
  });

  it("releases the caller's active claims", async () => {
    const { companyId, agentId, wsId, runSelf } = await seedSharedWorkspaceRun();

    const acquireRes = await request(createApp(agentActor(companyId, agentId, runSelf)))
      .post(`/api/companies/${companyId}/workspace-path-claims`)
      .send({ path: "src/pay/api" });
    expect(acquireRes.status, JSON.stringify(acquireRes.body)).toBe(201);

    const releaseRes = await request(createApp(agentActor(companyId, agentId, runSelf)))
      .post(`/api/companies/${companyId}/workspace-path-claims/release`)
      .send();
    expect(releaseRes.status, JSON.stringify(releaseRes.body)).toBe(200);
    expect(releaseRes.body).toEqual({ released: true });

    const active = await db
      .select()
      .from(workspacePathClaims)
      .where(eq(workspacePathClaims.executionWorkspaceId, wsId));
    expect(active.every((c) => c.status !== "active")).toBe(true);
  });
});
// [END: module]
