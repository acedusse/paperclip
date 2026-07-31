/**
 * FILE: server/src/__tests__/bounded-agent-approvers-routes.test.ts
 * ABOUT: bounded-agent-approvers-routes.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - bounded-agent-approvers-routes.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: bounded-agent-approvers-routes.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/bounded-agent-approvers-routes.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  boundedAgentApprovers,
  companies,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

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
    `Skipping bounded-agent-approvers route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

type Db = ReturnType<typeof createDb>;

function boardActor(companyId: string, userId = "user-board-1"): Express.Request["actor"] {
  return {
    type: "board",
    userId,
    companyIds: [companyId],
    source: "local_implicit",
    isInstanceAdmin: true,
  } as Express.Request["actor"];
}

async function createApp(db: Db, actor: Express.Request["actor"]) {
  process.env.PAPERCLIP_LOG_DIR = "/tmp/paperclip-test-home/logs";
  process.env.PAPERCLIP_IN_WORKTREE = "false";
  const [{ errorHandler }, { boundedAgentApproverRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/bounded-agent-approvers.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", boundedAgentApproverRoutes(db));
  app.use(errorHandler);
  return app;
}

async function seedCompany(db: Db, label: string) {
  return db
    .insert(companies)
    .values({
      name: `BoundedAgentApprovers ${label}`,
      issuePrefix: `BA${label.slice(0, 4).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

describeEmbeddedPostgres("bounded-agent-approvers routes", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("bounded-agent-approvers-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(boundedAgentApprovers);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("board can create, list, and revoke a bounded-agent approver grant", async () => {
    const company = await seedCompany(db, "Create");
    const app = await createApp(db, boardActor(company.id));

    const create = await request(app)
      .post(`/api/companies/${company.id}/bounded-agent-approvers`)
      .send({
        delegateAgentId: "mgr-agent",
        approvalTypes: ["hire_agent"],
        maxBand: "low",
        maxSpendCents: 1000,
        validUntil: "2026-12-31T00:00:00.000Z",
      });
    expect(create.status, JSON.stringify(create.body)).toBe(200);
    expect(create.body).toMatchObject({
      companyId: company.id,
      grantorUserId: "user-board-1",
      delegateAgentId: "mgr-agent",
    });
    const grantId = create.body.id as string;

    const list = await request(app).get(`/api/companies/${company.id}/bounded-agent-approvers`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.map((g: { id: string }) => g.id)).toContain(grantId);

    const revoke = await request(app).post(`/api/bounded-agent-approvers/${grantId}/revoke`).send({});
    expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
    expect(revoke.body.revokedAt).not.toBeNull();
  });

  it("rejects a grant whose maxBand exceeds the auto ceiling", async () => {
    const company = await seedCompany(db, "Reject");
    const app = await createApp(db, boardActor(company.id));

    const res = await request(app)
      .post(`/api/companies/${company.id}/bounded-agent-approvers`)
      .send({
        delegateAgentId: "mgr-agent",
        approvalTypes: [],
        maxBand: "high",
        maxSpendCents: null,
        validUntil: "2026-12-31T00:00:00.000Z",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });
});
// [END: module]
