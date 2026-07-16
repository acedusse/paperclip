/**
 * FILE: server/src/__tests__/delegations-routes.test.ts
 * ABOUT: delegations-routes.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - delegations-routes.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: delegations-routes.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/delegations-routes.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
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
    `Skipping delegations route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
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
  const [{ errorHandler }, { delegationRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/delegations.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", delegationRoutes(db));
  app.use(errorHandler);
  return app;
}

async function seedCompany(db: Db, label: string) {
  return db
    .insert(companies)
    .values({
      name: `Delegations ${label}`,
      issuePrefix: `DG${label.slice(0, 4).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

describeEmbeddedPostgres("delegation/coverage/out-of-office routes", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("delegations-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(delegationGrants);
    await db.delete(companyCoverageConfig);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("creates a grant, lists it, then revokes it (re-revoke 404s)", async () => {
    const company = await seedCompany(db, "Create");
    const app = await createApp(db, boardActor(company.id));

    const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const createRes = await request(app)
      .post(`/api/companies/${company.id}/delegations`)
      .send({
        delegateUserId: "bob",
        approvalTypes: [],
        maxBand: "low",
        maxSpendCents: null,
        validUntil,
      });

    expect(createRes.status, JSON.stringify(createRes.body)).toBe(200);
    expect(createRes.body).toMatchObject({
      companyId: company.id,
      grantorUserId: "user-board-1",
      delegateUserId: "bob",
    });
    const grantId = createRes.body.id as string;

    const listRes = await request(app).get(`/api/companies/${company.id}/delegations`);
    expect(listRes.status, JSON.stringify(listRes.body)).toBe(200);
    expect(listRes.body.map((g: { id: string }) => g.id)).toContain(grantId);

    const revokeRes = await request(app).post(`/api/delegations/${grantId}/revoke`).send({});
    expect(revokeRes.status, JSON.stringify(revokeRes.body)).toBe(200);
    expect(revokeRes.body.revokedAt).not.toBeNull();

    const reRevokeRes = await request(app).post(`/api/delegations/${grantId}/revoke`).send({});
    expect(reRevokeRes.status, JSON.stringify(reRevokeRes.body)).toBe(404);
  });

  it("revoking an unknown grant id 404s", async () => {
    const company = await seedCompany(db, "Unknown");
    const app = await createApp(db, boardActor(company.id));

    const res = await request(app)
      .post(`/api/delegations/00000000-0000-0000-0000-000000000000/revoke`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  it("PUT coverage-config rejects enabled:true without a backup, accepts it with one, and GET reflects it", async () => {
    const company = await seedCompany(db, "Coverage");
    const app = await createApp(db, boardActor(company.id));

    const badRes = await request(app)
      .put(`/api/companies/${company.id}/coverage-config`)
      .send({ enabled: true });
    expect(badRes.status, JSON.stringify(badRes.body)).toBe(400);

    const goodRes = await request(app)
      .put(`/api/companies/${company.id}/coverage-config`)
      .send({ enabled: true, backupUserId: "carol" });
    expect(goodRes.status, JSON.stringify(goodRes.body)).toBe(200);
    expect(goodRes.body).toMatchObject({
      companyId: company.id,
      enabled: true,
      backupUserId: "carol",
    });

    const getRes = await request(app).get(`/api/companies/${company.id}/coverage-config`);
    expect(getRes.status, JSON.stringify(getRes.body)).toBe(200);
    expect(getRes.body).toMatchObject({ companyId: company.id, enabled: true, backupUserId: "carol" });
  });

  it("POST out-of-office enables a preset grant and disabling it revokes the preset", async () => {
    const company = await seedCompany(db, "OOO");
    const app = await createApp(db, boardActor(company.id));

    const until = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const enableRes = await request(app)
      .post(`/api/companies/${company.id}/out-of-office`)
      .send({ enabled: true, backupUserId: "dave", maxBand: "medium", until });

    expect(enableRes.status, JSON.stringify(enableRes.body)).toBe(200);
    expect(enableRes.body.grant).toMatchObject({
      companyId: company.id,
      delegateUserId: "dave",
      source: "out_of_office",
    });

    const disableRes = await request(app)
      .post(`/api/companies/${company.id}/out-of-office`)
      .send({ enabled: false });

    expect(disableRes.status, JSON.stringify(disableRes.body)).toBe(200);
    expect(disableRes.body.grant).toBeNull();
    expect(disableRes.body.revokedIds).toContain(enableRes.body.grant.id);
  });
});
// [END: module]
