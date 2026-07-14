/**
 * FILE: server/src/__tests__/approvals-high-risk-push.test.ts
 * ABOUT: approvals-high-risk-push.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - risk-gated web push trigger on approval create integration tests.
 */
// ==========================================
// [META: module]
// INTENT: Verify a high/critical-band approval created via POST /approvals fires a web push, while a
//   below-high-band approval does not.
// PSEUDOCODE: 1. Mock web-push. 2. Register webpush channel + seed company/agent/subscription.
//   3. POST a budget_override_required approval with a sensitive+spendy payload -> critical band -> push sent.
//   4. Clear the mock. POST a request_board_approval with an empty payload -> medium band -> no push.
// JSON_FLOW: {"file": "server/src/__tests__/approvals-high-risk-push.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { vi } from "vitest";

vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: vi.fn(() => ({ publicKey: "PUB", privateKey: "PRIV" })),
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(() => Promise.resolve({})),
  },
}));

vi.hoisted(() => {
  process.env.PAPERCLIP_HOME = "/tmp/paperclip-test-home";
  process.env.PAPERCLIP_INSTANCE_ID = "vitest";
  process.env.PAPERCLIP_LOG_DIR = "/tmp/paperclip-test-home/logs";
  process.env.PAPERCLIP_IN_WORKTREE = "false";
});

// Keep every real service (real DB, real risk scoring, real delivery channels), but stub only the
// heavyweight requester wakeup so it does not spin up a real execution environment during the test.
vi.mock("../services/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/index.js")>();
  return {
    ...actual,
    heartbeatService: () => ({ wakeup: vi.fn().mockResolvedValue({ id: "wake-1" }) }),
  };
});

import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import webpush from "web-push";
import {
  activityLog,
  agents,
  approvalRisk,
  approvals,
  autoApprovePolicies,
  companies,
  createDb,
  pushSubscriptions,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { createWebPushChannel, registerChannel } from "../services/index.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping high-risk push route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
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

describeEmbeddedPostgres("risk-gated web push on approval create", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-high-risk-push-");
    db = createDb(tempDb.connectionString);
    registerChannel(createWebPushChannel(db));
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(autoApprovePolicies);
    await db.delete(approvalRisk);
    await db.delete(approvals);
    await db.delete(pushSubscriptions);
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
        name: "HRP Create",
        issuePrefix: `HRP${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
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

  it("fires a web push for a high/critical-band approval but not for a below-high one", async () => {
    const company = await seedCompany();
    const agent = await seedAgent(company.id, "NotAllowlisted");
    const app = await createApp(db, boardActor(company.id));

    await db.insert(pushSubscriptions).values({
      companyId: company.id,
      userId: "user-board-1",
      endpoint: "https://push.example.com/sub-1",
      p256dh: "p256dh-1",
      auth: "auth-1",
    });

    (webpush as any).sendNotification.mockClear();

    // budget_override_required with a large budgetMonthlyCents: sensitive-payload-key (+40) +
    // implied spend >= $50 (+45) + unknown trust (+40) caps at score 100 -> band "critical" (>= high).
    const highRiskCreated = await request(app)
      .post(`/api/companies/${company.id}/approvals`)
      .send({
        type: "budget_override_required",
        requestedByAgentId: agent.id,
        payload: { budgetMonthlyCents: 900000 },
      });
    expect(highRiskCreated.status, JSON.stringify(highRiskCreated.body)).toBe(201);
    expect(highRiskCreated.body.status).not.toBe("approved");

    await vi.waitFor(() => {
      expect((webpush as any).sendNotification).toHaveBeenCalled();
    });

    (webpush as any).sendNotification.mockClear();

    // request_board_approval with an empty payload from the same non-allowlisted agent: only
    // unknown trust (+40) -> band "medium" (< high) -> no push.
    const belowHighCreated = await request(app)
      .post(`/api/companies/${company.id}/approvals`)
      .send({ type: "request_board_approval", requestedByAgentId: agent.id, payload: {} });
    expect(belowHighCreated.status, JSON.stringify(belowHighCreated.body)).toBe(201);
    expect(belowHighCreated.body.status).not.toBe("approved");

    // Give any (incorrect) fire-and-forget push a moment to land before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((webpush as any).sendNotification).not.toHaveBeenCalled();
  });
});
// [END: module]
