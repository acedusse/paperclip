/**
 * FILE: server/src/__tests__/digest-routes.test.ts
 * ABOUT: digest-routes.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - board-only digest read/generate route tests.
 */
// ==========================================
// [META: module]
// INTENT: Verify latest/list/generate routes + board gating for company digests.
// PSEUDOCODE: 1. Register inbox digest channel against test db. 2. Seed company.
// 3. latest before any digest -> 404. 4. board generate -> 200 + headline.
// 5. latest/list after -> 200 + non-empty. 6. non-board generate -> 403.
// JSON_FLOW: {"file": "server/src/__tests__/digest-routes.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { companies, createDb, digests } from "@paperclipai/db";
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
    `Skipping digest route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
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
  const [{ errorHandler }, { digestRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/digests.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", digestRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("digest read/generate routes", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-digest-routes-");
    db = createDb(tempDb.connectionString);
    const { createInboxDigestChannel, registerChannel } = await import("../services/index.js");
    registerChannel(createInboxDigestChannel(db));
  }, 20_000);

  afterEach(async () => {
    await db.delete(digests);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(label: string) {
    return db
      .insert(companies)
      .values({
        name: `Digest ${label}`,
        issuePrefix: `DG${label.slice(0, 4).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  it("gates by board, generates a digest, and lists it", async () => {
    const company = await seedCompany("Crud");
    const boardApp = await createApp(db, boardActor(company.id));

    // latest before any digest -> 404
    const empty = await request(boardApp).get(`/api/companies/${company.id}/digests/latest`);
    expect(empty.status).toBe(404);

    // generate as board -> 200 + a digest
    const gen = await request(boardApp).post(`/api/companies/${company.id}/digests/generate`);
    expect(gen.status, JSON.stringify(gen.body)).toBe(200);
    expect(gen.body.payload.headline).toBeTruthy();

    // latest now returns it
    const latest = await request(boardApp).get(`/api/companies/${company.id}/digests/latest`);
    expect(latest.status).toBe(200);

    // list returns at least one
    const list = await request(boardApp).get(`/api/companies/${company.id}/digests`);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThanOrEqual(1);

    // non-board generate -> 403
    const agentApp = await createApp(db, agentActor(company.id));
    const forbidden = await request(agentApp).post(`/api/companies/${company.id}/digests/generate`);
    expect(forbidden.status).toBe(403);
  });
});
// [END: module]
