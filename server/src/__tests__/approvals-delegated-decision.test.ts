/**
 * FILE: server/src/__tests__/approvals-delegated-decision.test.ts
 * ABOUT: approvals-delegated-decision.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - approvals-delegated-decision.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: approvals-delegated-decision.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/approvals-delegated-decision.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  approvalCoverageEscalations,
  approvalRisk,
  approvals,
  companies,
  companyCoverageConfig,
  createDb,
  delegationGrants,
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
    `Skipping approvals delegated-decision route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
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
      name: `Delegated Decision ${label}`,
      issuePrefix: `DD${label.slice(0, 4).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function seedPendingApproval(
  db: Db,
  companyId: string,
  band: "low" | "medium" | "high" | "critical" = "low",
) {
  const scoreByBand = { low: 10, medium: 40, high: 70, critical: 95 } as const;
  const [approval] = await db
    .insert(approvals)
    .values({
      companyId,
      type: "request_board_approval",
      payload: { title: "Ship the thing" },
      status: "pending",
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

describeEmbeddedPostgres("delegated_human decision path + coverage_escalation attribution", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("approvals-delegated-decision-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(approvalCoverageEscalations);
    await db.delete(delegationGrants);
    await db.delete(companyCoverageConfig);
    await db.delete(approvalRisk);
    await db.delete(approvals);
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

  it("1. bob approves under his grant -> 200, delegated_human, audit has onBehalfOf + grantId", async () => {
    const company = await seedCompany(db, "Grant1");
    const approval = await seedPendingApproval(db, company.id, "low");

    const [grant] = await db
      .insert(delegationGrants)
      .values({
        companyId: company.id,
        grantorUserId: "alice",
        delegateUserId: "bob",
        approvalTypes: [],
        maxBand: "medium",
        maxSpendCents: null,
        validFrom: new Date(Date.now() - 60_000),
        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning();

    const app = await createApp(db, boardActor(company.id, "bob"));
    const res = await request(app)
      .post(`/api/approvals/${approval.id}/approve`)
      .send({ actingUnderGrantId: grant!.id, decisionNote: "on behalf of alice" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("approved");

    const decidedVia = await decidedViaFor(app, approval.id);
    expect(decidedVia).toBe("delegated_human");

    const [decisionRow] = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, approval.id), eq(activityLog.action, "approval.decision")));
    expect(decisionRow!.details).toMatchObject({
      method: "delegated_human",
      outcome: "approved",
      onBehalfOf: "alice",
      grantId: grant!.id,
    });
  });

  it("2. band above grant ceiling -> 422", async () => {
    const company = await seedCompany(db, "Grant2");
    const approval = await seedPendingApproval(db, company.id, "high");

    const [grant] = await db
      .insert(delegationGrants)
      .values({
        companyId: company.id,
        grantorUserId: "alice",
        delegateUserId: "bob",
        approvalTypes: [],
        maxBand: "low",
        maxSpendCents: null,
        validFrom: new Date(Date.now() - 60_000),
        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning();

    const app = await createApp(db, boardActor(company.id, "bob"));
    const res = await request(app)
      .post(`/api/approvals/${approval.id}/approve`)
      .send({ actingUnderGrantId: grant!.id });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
  });

  it("3. carol (not the delegate) uses bob's grant -> 422", async () => {
    const company = await seedCompany(db, "Grant3");
    const approval = await seedPendingApproval(db, company.id, "low");

    const [grant] = await db
      .insert(delegationGrants)
      .values({
        companyId: company.id,
        grantorUserId: "alice",
        delegateUserId: "bob",
        approvalTypes: [],
        maxBand: "medium",
        maxSpendCents: null,
        validFrom: new Date(Date.now() - 60_000),
        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning();

    const app = await createApp(db, boardActor(company.id, "carol"));
    const res = await request(app)
      .post(`/api/approvals/${approval.id}/approve`)
      .send({ actingUnderGrantId: grant!.id });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
  });

  it("4. unknown grant id -> 404", async () => {
    const company = await seedCompany(db, "Grant4");
    const approval = await seedPendingApproval(db, company.id, "low");

    const app = await createApp(db, boardActor(company.id, "bob"));
    const res = await request(app)
      .post(`/api/approvals/${approval.id}/approve`)
      .send({ actingUnderGrantId: "00000000-0000-0000-0000-000000000000" });

    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  it("5. carol (configured backup) approves an escalated item with no grant -> coverage_escalation", async () => {
    const company = await seedCompany(db, "Coverage5");
    const approval = await seedPendingApproval(db, company.id, "low");

    await db.insert(companyCoverageConfig).values({
      companyId: company.id,
      enabled: true,
      backupUserId: "carol",
    });
    await db.insert(approvalCoverageEscalations).values({
      approvalId: approval.id,
      companyId: company.id,
      backupUserId: "carol",
    });

    const app = await createApp(db, boardActor(company.id, "carol"));
    const res = await request(app).post(`/api/approvals/${approval.id}/approve`).send({});

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const decidedVia = await decidedViaFor(app, approval.id);
    expect(decidedVia).toBe("coverage_escalation");
  });

  it("6. dave (not the backup) approves the same escalated item with no grant -> explicit_human", async () => {
    const company = await seedCompany(db, "Coverage6");
    const approval = await seedPendingApproval(db, company.id, "low");

    await db.insert(companyCoverageConfig).values({
      companyId: company.id,
      enabled: true,
      backupUserId: "carol",
    });
    await db.insert(approvalCoverageEscalations).values({
      approvalId: approval.id,
      companyId: company.id,
      backupUserId: "carol",
    });

    const app = await createApp(db, boardActor(company.id, "dave"));
    const res = await request(app).post(`/api/approvals/${approval.id}/approve`).send({});

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const decidedVia = await decidedViaFor(app, approval.id);
    expect(decidedVia).toBe("explicit_human");
  });
});
// [END: module]
