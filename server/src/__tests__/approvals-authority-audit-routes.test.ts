/**
 * FILE: server/src/__tests__/approvals-authority-audit-routes.test.ts
 * ABOUT: approvals-authority-audit-routes.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - approvals-authority-audit-routes.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: approvals-authority-audit-routes.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/approvals-authority-audit-routes.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  approvalRisk,
  approvals,
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
    `Skipping approvals authority/audit route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
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
      name: `Authority Audit ${label}`,
      issuePrefix: `AA${label.slice(0, 4).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

describeEmbeddedPostgres("approvals routed through authority resolver + decision audit", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-approvals-authority-audit-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(approvalRisk);
    await db.delete(approvals);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("computes a risk snapshot on create, and approving as board records a decision audit row alongside the existing approval.approved event", async () => {
    const company = await seedCompany(db, "Approve");
    const app = await createApp(db, boardActor(company.id));

    const createRes = await request(app)
      .post(`/api/companies/${company.id}/approvals`)
      .send({ type: "request_board_approval", payload: { title: "Ship the thing" } });

    expect(createRes.status, JSON.stringify(createRes.body)).toBe(201);
    const approvalId = createRes.body.id as string;

    // Risk snapshot must exist after create.
    const riskRows = await db
      .select()
      .from(approvalRisk)
      .where(eq(approvalRisk.approvalId, approvalId));
    expect(riskRows).toHaveLength(1);
    expect(riskRows[0]!.band).toEqual(expect.any(String));

    const approveRes = await request(app)
      .post(`/api/approvals/${approvalId}/approve`)
      .send({ decisionNote: "looks good" });

    // Response shape is unchanged: 200 + the approval JSON.
    expect(approveRes.status, JSON.stringify(approveRes.body)).toBe(200);
    expect(approveRes.body).toMatchObject({ id: approvalId, status: "approved" });

    // New unified decision-audit row.
    const decisionRows = await db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityId, approvalId),
          eq(activityLog.action, "approval.decision"),
        ),
      );
    expect(decisionRows).toHaveLength(1);
    expect(decisionRows[0]!.details).toMatchObject({
      method: "explicit_human",
      outcome: "approved",
    });

    // No-op preservation: the pre-existing domain event still fires.
    const approvedRows = await db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityId, approvalId),
          eq(activityLog.action, "approval.approved"),
        ),
      );
    expect(approvedRows).toHaveLength(1);
  });
});
// [END: module]
