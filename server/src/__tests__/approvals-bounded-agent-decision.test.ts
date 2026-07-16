/**
 * FILE: server/src/__tests__/approvals-bounded-agent-decision.test.ts
 * ABOUT: approvals-bounded-agent-decision.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - approvals-bounded-agent-decision.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: Combo-05 Phase 4b - bounded_agent decision path integration tests.
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/approvals-bounded-agent-decision.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  approvalRisk,
  approvals,
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
    `Skipping approvals bounded-agent decision route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
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

function agentActor(companyId: string, agentId: string): Express.Request["actor"] {
  return { type: "agent", agentId, companyId, source: "agent_key" } as Express.Request["actor"];
}

async function createApp(db: Db, actor: Express.Request["actor"]) {
  process.env.PAPERCLIP_LOG_DIR = "/tmp/paperclip-test-home/logs";
  process.env.PAPERCLIP_IN_WORKTREE = "false";
  const [{ errorHandler }, { approvalRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/approvals.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", approvalRoutes(db));
  app.use(errorHandler);
  return app;
}

async function seedCompany(db: Db, label: string) {
  return db
    .insert(companies)
    .values({
      name: `Bounded Agent Decision ${label}`,
      issuePrefix: `BA${label.slice(0, 4).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function seedAgent(db: Db, companyId: string, name: string) {
  return db
    .insert(agents)
    .values({ companyId, name, role: "engineer", adapterType: "codex_local", adapterConfig: {} })
    .returning()
    .then((rows) => rows[0]!);
}

async function seedPendingApproval(
  db: Db,
  companyId: string,
  band: "low" | "medium" | "high" | "critical" = "low",
  requestedByAgentId: string | null = null,
) {
  const scoreByBand = { low: 10, medium: 40, high: 70, critical: 95 } as const;
  const [approval] = await db
    .insert(approvals)
    .values({
      companyId,
      type: "request_board_approval",
      payload: { title: "Ship the thing" },
      status: "pending",
      requestedByAgentId,
    })
    .returning();
  await db.insert(approvalRisk).values({
    approvalId: approval!.id,
    companyId,
    score: scoreByBand[band],
    band,
    reasons: [],
  });
  return approval!;
}

async function seedGrant(
  db: Db,
  companyId: string,
  delegateAgentId: string,
  overrides: Partial<{ maxBand: "low" | "medium" | "high" | "critical"; maxSpendCents: number | null }> = {},
) {
  const [grant] = await db
    .insert(boundedAgentApprovers)
    .values({
      companyId,
      grantorUserId: "alice",
      delegateAgentId,
      approvalTypes: [],
      maxBand: overrides.maxBand ?? "low",
      maxSpendCents: overrides.maxSpendCents ?? null,
      validFrom: new Date(Date.now() - 60_000),
      validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning();
  return grant!;
}

describeEmbeddedPostgres("bounded_agent decision path + agent-typed audit attribution", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("approvals-bounded-agent-decision-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(boundedAgentApprovers);
    await db.delete(approvalRisk);
    await db.delete(approvals);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function decidedViaFor(app: express.Express, approvalId: string) {
    const res = await request(app).get(`/api/approvals/${approvalId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.decidedVia as string | null;
  }

  it("1. a granted manager-agent approves a low-band item it did not request, audited as agent", async () => {
    const company = await seedCompany(db, "Happy1");
    const mgrAgent = await seedAgent(db, company.id, "Manager");
    const approval = await seedPendingApproval(db, company.id, "low", null);
    const grant = await seedGrant(db, company.id, mgrAgent.id, { maxBand: "low" });

    const app = await createApp(db, agentActor(company.id, mgrAgent.id));
    const res = await request(app)
      .post(`/api/approvals/${approval.id}/approve`)
      .send({ actingUnderGrantId: grant.id, decisionNote: "on behalf of alice" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("approved");

    const decidedVia = await decidedViaFor(app, approval.id);
    expect(decidedVia).toBe("bounded_agent");

    const [decisionRow] = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, approval.id), eq(activityLog.action, "approval.decision")));
    expect(decisionRow!.details).toMatchObject({
      method: "bounded_agent",
      outcome: "approved",
      onBehalfOf: "alice",
      grantId: grant.id,
    });
    expect(decisionRow!.actorType).toBe("agent");
    expect(decisionRow!.actorId).toBe(mgrAgent.id);
  });

  it("1b. a granted manager-agent rejects a low-band item it did not request, audited as agent", async () => {
    const company = await seedCompany(db, "Happy1b");
    const mgrAgent = await seedAgent(db, company.id, "Manager");
    const approval = await seedPendingApproval(db, company.id, "low", null);
    const grant = await seedGrant(db, company.id, mgrAgent.id, { maxBand: "low" });

    const app = await createApp(db, agentActor(company.id, mgrAgent.id));
    const res = await request(app)
      .post(`/api/approvals/${approval.id}/reject`)
      .send({ actingUnderGrantId: grant.id, decisionNote: "on behalf of alice" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("rejected");

    const [decisionRow] = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, approval.id), eq(activityLog.action, "approval.decision")));
    expect(decisionRow!.details).toMatchObject({
      method: "bounded_agent",
      outcome: "rejected",
      onBehalfOf: "alice",
      grantId: grant.id,
    });
    expect(decisionRow!.actorType).toBe("agent");
    expect(decisionRow!.actorId).toBe(mgrAgent.id);
  });

  it("2. denies self-approval (agent approving its own requested item) with 422", async () => {
    const company = await seedCompany(db, "Self2");
    const workerAgent = await seedAgent(db, company.id, "Worker");
    const approval = await seedPendingApproval(db, company.id, "low", workerAgent.id);
    const grant = await seedGrant(db, company.id, workerAgent.id, { maxBand: "low" });

    const app = await createApp(db, agentActor(company.id, workerAgent.id));
    const res = await request(app)
      .post(`/api/approvals/${approval.id}/approve`)
      .send({ actingUnderGrantId: grant.id });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error).toContain("own work");
  });

  it("3. an agent with no grant is still board-gated (403) on approve", async () => {
    const company = await seedCompany(db, "NoGrant3");
    const mgrAgent = await seedAgent(db, company.id, "Manager");
    const approval = await seedPendingApproval(db, company.id, "low", null);

    const app = await createApp(db, agentActor(company.id, mgrAgent.id));
    const res = await request(app).post(`/api/approvals/${approval.id}/approve`).send({});

    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("4. denies an above-band item even with a grant (422)", async () => {
    const company = await seedCompany(db, "AboveBand4");
    const mgrAgent = await seedAgent(db, company.id, "Manager");
    const highBandApproval = await seedPendingApproval(db, company.id, "high", null);
    const grant = await seedGrant(db, company.id, mgrAgent.id, { maxBand: "low" });

    const app = await createApp(db, agentActor(company.id, mgrAgent.id));
    const res = await request(app)
      .post(`/api/approvals/${highBandApproval.id}/approve`)
      .send({ actingUnderGrantId: grant.id });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
  });
});
// [END: module]
