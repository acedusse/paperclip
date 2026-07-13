/**
 * FILE: server/src/__tests__/approval-triage-routes.test.ts
 * ABOUT: approval-triage-routes.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - approval-triage-routes.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: approval-triage-routes.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/approval-triage-routes.test.ts", "imports": "see code", "exports": "see code"}
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
    `Skipping approval triage/bulk route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
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
      name: `Triage ${label}`,
      issuePrefix: `TR${label.slice(0, 4).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function seedApproval(
  db: Db,
  companyId: string,
  input: { type: string; payload: Record<string, unknown>; risk: { score: number; band: string } },
) {
  const approval = await db
    .insert(approvals)
    .values({
      companyId,
      type: input.type,
      payload: input.payload,
      status: "pending",
    })
    .returning()
    .then((rows) => rows[0]!);

  await db.insert(approvalRisk).values({
    approvalId: approval.id,
    companyId,
    score: input.risk.score,
    band: input.risk.band,
    reasons: [`seeded ${input.risk.band}`],
  });

  return approval;
}

describeEmbeddedPostgres("approval triage inbox + bulk resolve", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-approval-triage-");
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

  it("sorts triage items by risk score descending and groups low-risk items by type", async () => {
    const company = await seedCompany(db, "Sort");
    const app = await createApp(db, boardActor(company.id));

    const critical = await seedApproval(db, company.id, {
      type: "hire_agent",
      payload: { name: "Big Spender", role: "engineer", budgetMonthlyCents: 900_000 },
      risk: { score: 90, band: "critical" },
    });
    const low1 = await seedApproval(db, company.id, {
      type: "work_product",
      payload: { title: "Draft copy" },
      risk: { score: 5, band: "low" },
    });
    const low2 = await seedApproval(db, company.id, {
      type: "work_product",
      payload: { title: "Draft copy 2" },
      risk: { score: 8, band: "low" },
    });
    const low3 = await seedApproval(db, company.id, {
      type: "work_product",
      payload: { title: "Draft copy 3" },
      risk: { score: 2, band: "low" },
    });

    const res = await request(app).get(`/api/companies/${company.id}/approvals/triage`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const items = res.body.items as Array<{ id: string; risk: { score: number } }>;
    expect(items).toHaveLength(4);
    const scores = items.map((it) => it.risk.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(items[0]!.id).toBe(critical.id);

    const groups = res.body.groups as Array<{ type: string; ids: string[] }>;
    const workProductGroup = groups.find((g) => g.type === "work_product");
    expect(workProductGroup).toBeDefined();
    expect(new Set(workProductGroup!.ids)).toEqual(new Set([low1.id, low2.id, low3.id]));

    return { low1, low2, low3 };
  });

  it("bulk-resolves a batch of low-risk approvals, approving all and writing one audit row per id", async () => {
    const company = await seedCompany(db, "Bulk");
    const app = await createApp(db, boardActor(company.id));

    const low1 = await seedApproval(db, company.id, {
      type: "work_product",
      payload: { title: "Draft copy" },
      risk: { score: 5, band: "low" },
    });
    const low2 = await seedApproval(db, company.id, {
      type: "work_product",
      payload: { title: "Draft copy 2" },
      risk: { score: 8, band: "low" },
    });
    const low3 = await seedApproval(db, company.id, {
      type: "work_product",
      payload: { title: "Draft copy 3" },
      risk: { score: 2, band: "low" },
    });

    const bulkRes = await request(app)
      .post(`/api/companies/${company.id}/approvals/bulk`)
      .send({ ids: [low1.id, low2.id, low3.id], action: "approve" });

    expect(bulkRes.status, JSON.stringify(bulkRes.body)).toBe(200);
    expect(bulkRes.body.results).toHaveLength(3);
    for (const r of bulkRes.body.results) {
      expect(r.ok).toBe(true);
    }

    const updated = await db
      .select()
      .from(approvals)
      .where(eq(approvals.companyId, company.id));
    expect(updated).toHaveLength(3);
    for (const approval of updated) {
      expect(approval.status).toBe("approved");
    }

    const decisionRows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, company.id), eq(activityLog.action, "approval.decision")));
    expect(decisionRows).toHaveLength(3);
  });

  it("treats a duplicate id in one batch as an idempotent success and writes exactly one audit row", async () => {
    const company = await seedCompany(db, "Dup");
    const app = await createApp(db, boardActor(company.id));

    const low = await seedApproval(db, company.id, {
      type: "work_product",
      payload: { title: "Draft copy" },
      risk: { score: 5, band: "low" },
    });

    const bulkRes = await request(app)
      .post(`/api/companies/${company.id}/approvals/bulk`)
      .send({ ids: [low.id, low.id], action: "approve" });

    expect(bulkRes.status, JSON.stringify(bulkRes.body)).toBe(200);
    // Both entries report success (idempotent), matching single-item semantics.
    expect(bulkRes.body.results).toHaveLength(2);
    for (const r of bulkRes.body.results) {
      expect(r.ok).toBe(true);
    }

    // ...but only the first, applied transition writes an audit row.
    const decisionRows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, low.id), eq(activityLog.action, "approval.decision")));
    expect(decisionRows).toHaveLength(1);
  });

  it("rejects an id belonging to a different company without mutating it", async () => {
    const company = await seedCompany(db, "Own");
    const otherCompany = await seedCompany(db, "Foreign");
    const app = await createApp(db, boardActor(company.id));

    const mine = await seedApproval(db, company.id, {
      type: "work_product",
      payload: { title: "Mine" },
      risk: { score: 5, band: "low" },
    });
    const foreign = await seedApproval(db, otherCompany.id, {
      type: "work_product",
      payload: { title: "Not mine" },
      risk: { score: 5, band: "low" },
    });

    const bulkRes = await request(app)
      .post(`/api/companies/${company.id}/approvals/bulk`)
      .send({ ids: [mine.id, foreign.id], action: "approve" });

    expect(bulkRes.status, JSON.stringify(bulkRes.body)).toBe(200);
    const results = bulkRes.body.results as Array<{ id: string; ok: boolean; error?: string }>;
    const mineResult = results.find((r) => r.id === mine.id);
    const foreignResult = results.find((r) => r.id === foreign.id);
    expect(mineResult?.ok).toBe(true);
    expect(foreignResult?.ok).toBe(false);
    expect(foreignResult?.error).toBeTruthy();

    // The foreign approval must remain untouched.
    const foreignAfter = await db
      .select()
      .from(approvals)
      .where(eq(approvals.id, foreign.id))
      .then((rows) => rows[0]!);
    expect(foreignAfter.status).toBe("pending");
  });
});
// [END: module]
