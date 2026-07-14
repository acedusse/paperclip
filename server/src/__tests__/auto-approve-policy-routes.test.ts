/**
 * FILE: server/src/__tests__/auto-approve-policy-routes.test.ts
 * ABOUT: auto-approve-policy-routes.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - board-only auto-approve policy CRUD route tests.
 */
// ==========================================
// [META: module]
// INTENT: Verify list/create/patch routes + board gating + validation for auto-approve policies.
// PSEUDOCODE: 1. Seed company/agent. 2. Create/list/patch as board. 3. Non-board 403, bad band 4xx.
// JSON_FLOW: {"file": "server/src/__tests__/auto-approve-policy-routes.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, autoApprovePolicies, companies, createDb } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

vi.hoisted(() => {
  process.env.PAPERCLIP_HOME = "/tmp/paperclip-test-home";
  process.env.PAPERCLIP_INSTANCE_ID = "vitest";
  process.env.PAPERCLIP_LOG_DIR = "/tmp/paperclip-test-home/logs";
  process.env.PAPERCLIP_IN_WORKTREE = "false";
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping auto-approve policy route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

type Db = ReturnType<typeof createDb>;

function boardActor(companyId: string): Express.Request["actor"] {
  return {
    type: "board",
    userId: "user-board-1",
    companyIds: [companyId],
    source: "local_implicit",
    isInstanceAdmin: true,
  } as Express.Request["actor"];
}

function agentActor(companyId: string): Express.Request["actor"] {
  return {
    type: "agent",
    userId: "agent-actor-1",
    companyIds: [companyId],
    source: "token",
    isInstanceAdmin: false,
  } as Express.Request["actor"];
}

async function createApp(db: Db, actor: Express.Request["actor"]) {
  const [{ errorHandler }, { autoApprovePolicyRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/auto-approve-policies.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", autoApprovePolicyRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("auto-approve policy CRUD routes", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-auto-approve-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(autoApprovePolicies);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(label: string) {
    return db
      .insert(companies)
      .values({
        name: `AA ${label}`,
        issuePrefix: `AA${label.slice(0, 4).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  async function seedAgent(companyId: string) {
    return db
      .insert(agents)
      .values({ companyId, name: "CodexCoder", role: "engineer", adapterType: "codex_local", adapterConfig: {} })
      .returning()
      .then((rows) => rows[0]!);
  }

  it("creates, lists, gates by board, validates band, and toggles", async () => {
    const company = await seedCompany("Crud");
    const agent = await seedAgent(company.id);
    const boardApp = await createApp(db, boardActor(company.id));
    const validBody = {
      agentId: agent.id,
      approvalType: "work_product",
      maxBand: "low",
      maxSpendCents: 0,
      requireNoSecrets: true,
    };

    // create as board
    const created = await request(boardApp)
      .post(`/api/companies/${company.id}/auto-approve-policies`)
      .send(validBody);
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.id).toBeTruthy();

    // list
    const list = await request(boardApp).get(`/api/companies/${company.id}/auto-approve-policies`);
    expect(list.status).toBe(200);
    expect((list.body as Array<{ id: string }>).some((p) => p.id === created.body.id)).toBe(true);

    // non-board create → 403
    const agentApp = await createApp(db, agentActor(company.id));
    const forbidden = await request(agentApp)
      .post(`/api/companies/${company.id}/auto-approve-policies`)
      .send(validBody);
    expect(forbidden.status).toBe(403);

    // band above the locked max → validation 4xx
    const bad = await request(boardApp)
      .post(`/api/companies/${company.id}/auto-approve-policies`)
      .send({ ...validBody, maxBand: "medium" });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);

    // deactivate via PATCH
    const patched = await request(boardApp)
      .patch(`/api/companies/${company.id}/auto-approve-policies/${created.body.id}`)
      .send({ isActive: false });
    expect(patched.status).toBe(200);
    expect(patched.body.isActive).toBe(false);

    // deactivated policy drops out of the active list
    const listAfter = await request(boardApp).get(`/api/companies/${company.id}/auto-approve-policies`);
    expect((listAfter.body as Array<{ id: string }>).some((p) => p.id === created.body.id)).toBe(false);
  });
});
// [END: module]
