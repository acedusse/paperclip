/**
 * FILE: server/src/__tests__/instance-admission-status-routes.test.ts
 * ABOUT: instance-admission-status-routes.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - instance-admission-status-routes.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: instance-admission-status-routes.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/instance-admission-status-routes.test.ts", "imports": "see code", "exports": "see code"}
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
  heartbeatRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { instanceSettingsRoutes } from "../routes/instance-settings.js";
import { companyRoutes } from "../routes/companies.js";
import { instanceSettingsService } from "../services/instance-settings.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres admission-status route tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("admission-status routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-admission-status-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(activityLog);
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
    app.use("/api", instanceSettingsRoutes(db));
    app.use(errorHandler);
    return app;
  }

  function createCompanyApp(actor: Express.Request["actor"]) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    app.use("/api/companies", companyRoutes(db));
    app.use(errorHandler);
    return app;
  }

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

  async function createAgentInCompany(companyId: string): Promise<string> {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: `Agent-${agentId.slice(0, 8)}`,
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return agentId;
  }

  async function insertRun(params: {
    companyId: string;
    agentId: string;
    status: "running" | "queued";
  }): Promise<void> {
    await db.insert(heartbeatRuns).values({
      id: randomUUID(),
      companyId: params.companyId,
      agentId: params.agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: params.status,
    });
  }

  it("GET /api/instance/admission-status returns cap/running/queued", async () => {
    await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });
    const company = await createCompany();
    const agent = await createAgentInCompany(company);
    await insertRun({ companyId: company, agentId: agent, status: "running" });

    const app = createApp({ type: "board", source: "local_implicit", isInstanceAdmin: true });
    const res = await request(app).get("/api/instance/admission-status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      cap: 10,
      source: "configured-default",
      running: 1,
      queued: 0,
      runExecutionState: "running",
    });
  });

  it("GET /api/instance/admission-status rejects non-board callers", async () => {
    const app = createApp({ type: "agent", agentId: "agent-1", companyId: "company-1", source: "agent_jwt" });
    const res = await request(app).get("/api/instance/admission-status");
    expect(res.status).toBe(403);
  });

  it("GET /api/companies/:id/admission-status returns that company's status", async () => {
    const company = await createCompany();
    await db.update(companies).set({ maxConcurrentRuns: 3 }).where(eq(companies.id, company));
    const app = createCompanyApp({ type: "board", source: "local_implicit", isInstanceAdmin: true });
    const res = await request(app).get(`/api/companies/${company}/admission-status`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      cap: 3,
      source: "configured-default",
      running: 0,
      queued: 0,
      runExecutionState: "running",
    });
  });

  it("GET /api/companies/:id/admission-status rejects callers without access to the company", async () => {
    const company = await createCompany();
    const otherCompany = await createCompany();
    const app = createCompanyApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [otherCompany],
    });
    const res = await request(app).get(`/api/companies/${company}/admission-status`);
    expect(res.status).toBe(403);
  });

  it("PATCH /api/companies/:id persists maxConcurrentRuns and clears it back to null", async () => {
    const company = await createCompany();
    const app = createCompanyApp({ type: "board", source: "local_implicit", isInstanceAdmin: true });

    const setRes = await request(app)
      .patch(`/api/companies/${company}`)
      .send({ maxConcurrentRuns: 7 });
    expect(setRes.status).toBe(200);
    expect(setRes.body.maxConcurrentRuns).toBe(7);

    const afterSetStatus = await request(app).get(`/api/companies/${company}/admission-status`);
    expect(afterSetStatus.status).toBe(200);
    expect(afterSetStatus.body).toEqual({
      cap: 7,
      source: "configured-default",
      running: 0,
      queued: 0,
      runExecutionState: "running",
    });

    const clearRes = await request(app)
      .patch(`/api/companies/${company}`)
      .send({ maxConcurrentRuns: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.maxConcurrentRuns).toBeNull();

    const afterClearStatus = await request(app).get(`/api/companies/${company}/admission-status`);
    expect(afterClearStatus.status).toBe(200);
    expect(afterClearStatus.body.cap).toBeNull();
  });
});
// [END: module]
