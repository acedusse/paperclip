/**
 * FILE: server/src/__tests__/approvals-auto-approve-routes.test.ts
 * ABOUT: approvals-auto-approve-routes.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - auto-approve-on-create integration tests.
 */
// ==========================================
// [META: module]
// INTENT: Verify a matching approval auto-approves on create (audited), non-match stays pending.
// PSEUDOCODE: 1. Seed company/agents/policy. 2. POST matching -> approved + audit. 3. POST non-match -> pending.
// JSON_FLOW: {"file": "server/src/__tests__/approvals-auto-approve-routes.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  agentWakeupRequests,
  agents,
  approvalRisk,
  approvals,
  autoApprovePolicies,
  companies,
  createDb,
  heartbeatRuns,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

vi.hoisted(() => {
  process.env.PAPERCLIP_HOME = "/tmp/paperclip-test-home";
  process.env.PAPERCLIP_INSTANCE_ID = "vitest";
  process.env.PAPERCLIP_LOG_DIR = "/tmp/paperclip-test-home/logs";
  process.env.PAPERCLIP_IN_WORKTREE = "false";
});

// Keep every real service (real DB, real auto-approve + audit), but stub only the heavyweight
// requester wakeup so it does not spin up a real execution environment during the test.
vi.mock("../services/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/index.js")>();
  return {
    ...actual,
    heartbeatService: () => ({ wakeup: vi.fn().mockResolvedValue({ id: "wake-1" }) }),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping auto-approve-on-create route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
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

describeEmbeddedPostgres("auto-approve on approval create", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-auto-approve-create-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(autoApprovePolicies);
    await db.delete(approvalRisk);
    await db.delete(approvals);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany() {
    return db
      .insert(companies)
      .values({
        name: "AA Create",
        issuePrefix: `AAC${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  async function seedAgent(companyId: string, name: string) {
    return db
      .insert(agents)
      .values({ companyId, name, role: "engineer", adapterType: "codex_local", adapterConfig: {} })
      .returning()
      .then((rows) => rows[0]!);
  }

  it("auto-approves a matching approval on create and audits it; non-allowlisted agent stays pending", async () => {
    const company = await seedCompany();
    const allowedAgent = await seedAgent(company.id, "Allowlisted");
    const otherAgent = await seedAgent(company.id, "NotAllowlisted");
    const app = await createApp(db, boardActor(company.id));

    await db.insert(autoApprovePolicies).values({
      companyId: company.id,
      agentId: allowedAgent.id,
      approvalType: "request_board_approval",
      maxBand: "low",
      maxSpendCents: 1000,
      requireNoSecrets: true,
    });

    // matching approval → auto-approved
    const created = await request(app)
      .post(`/api/companies/${company.id}/approvals`)
      .send({ type: "request_board_approval", requestedByAgentId: allowedAgent.id, payload: {} });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.status).toBe("approved");

    // exactly one approval.decision audit row, method auto_policy
    const decisions = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, created.body.id), eq(activityLog.action, "approval.decision")));
    expect(decisions).toHaveLength(1);
    expect((decisions[0]!.details as { method?: string }).method).toBe("auto_policy");

    // Phase-1 domain event still fires
    const approvedEvents = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, created.body.id), eq(activityLog.action, "approval.approved")));
    expect(approvedEvents.length).toBeGreaterThanOrEqual(1);

    // non-allowlisted agent → stays pending
    const pending = await request(app)
      .post(`/api/companies/${company.id}/approvals`)
      .send({ type: "request_board_approval", requestedByAgentId: otherAgent.id, payload: {} });
    expect(pending.status).toBe(201);
    expect(pending.body.status).toBe("pending");
  });
});
// [END: module]
