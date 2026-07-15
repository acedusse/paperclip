/**
 * FILE: server/src/__tests__/push-routes.test.ts
 * ABOUT: push-routes.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - board-only push subscription route tests (vapid key, subscribe, unsubscribe).
 */
// ==========================================
// [META: module]
// INTENT: Verify GET /push/vapid-public-key, POST/DELETE .../push/subscriptions board gating,
//   endpoint-keyed upsert idempotency, and unsubscribe deletion.
// PSEUDOCODE: 1. Mock web-push. 2. Seed a company. 3. Fetch vapid key. 4. Subscribe twice (idempotent).
//   5. Non-board subscribe -> 403. 6. Unsubscribe removes the row.
// JSON_FLOW: {"file": "server/src/__tests__/push-routes.test.ts", "imports": "see code", "exports": "see code"}
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

import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, createDb, pushDeliveryPrefs, pushSubscriptions } from "@paperclipai/db";
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
    `Skipping push route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
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
  const [{ errorHandler }, { pushRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/push.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", pushRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("push subscription routes", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-push-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(pushSubscriptions);
    await db.delete(pushDeliveryPrefs);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(label: string) {
    return db
      .insert(companies)
      .values({
        name: `Push ${label}`,
        issuePrefix: `PU${label.slice(0, 4).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  it("gates vapid key, upserts subscriptions idempotently by endpoint, and unsubscribes", async () => {
    const company = await seedCompany("Crud");
    const companyId = company.id;
    const boardApp = await createApp(db, boardActor(companyId));
    const agentApp = await createApp(db, agentActor(companyId));

    // vapid public key (any board actor)
    const vapid = await request(boardApp).get(`/api/push/vapid-public-key`);
    expect(vapid.status).toBe(200);
    expect(vapid.body.publicKey).toBe("PUB");

    // subscribe (board) then a duplicate endpoint upserts (idempotent — still one row)
    const body = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" }, userAgent: "UA" };
    expect((await request(boardApp).post(`/api/companies/${companyId}/push/subscriptions`).send(body)).status).toBe(200);
    expect((await request(boardApp).post(`/api/companies/${companyId}/push/subscriptions`).send(body)).status).toBe(200);
    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.companyId, companyId));
    expect(rows).toHaveLength(1);

    // non-board subscribe → 403
    expect((await request(agentApp).post(`/api/companies/${companyId}/push/subscriptions`).send(body)).status).toBe(403);

    // unsubscribe removes it
    expect((await request(boardApp).delete(`/api/companies/${companyId}/push/subscriptions`).send({ endpoint: body.endpoint })).status).toBe(200);
    expect((await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.companyId, companyId))).length).toBe(0);
  });

  it("returns default prefs, upserts them, and rejects a below-floor band", async () => {
    const company = await seedCompany("Prefs");
    const companyId = company.id;
    const boardApp = await createApp(db, boardActor(companyId));

    // default when no row
    const def = await request(boardApp).get(`/api/companies/${companyId}/push/prefs`);
    expect(def.status).toBe(200);
    expect(def.body).toEqual({ minBand: "high", quietStart: null, quietEnd: null, timezone: null });

    // upsert
    const put = await request(boardApp)
      .put(`/api/companies/${companyId}/push/prefs`)
      .send({ minBand: "critical", quietStart: "22:00", quietEnd: "08:00", timezone: "America/New_York" });
    expect(put.status).toBe(200);

    const got = await request(boardApp).get(`/api/companies/${companyId}/push/prefs`);
    expect(got.body).toEqual({ minBand: "critical", quietStart: "22:00", quietEnd: "08:00", timezone: "America/New_York" });

    // idempotent upsert (still one row)
    await request(boardApp).put(`/api/companies/${companyId}/push/prefs`).send({ minBand: "high", quietStart: null, quietEnd: null, timezone: null });
    const rows = await db.select().from(pushDeliveryPrefs).where(eq(pushDeliveryPrefs.companyId, companyId));
    expect(rows).toHaveLength(1);

    // below-floor rejected by validator
    expect((await request(boardApp).put(`/api/companies/${companyId}/push/prefs`).send({ minBand: "medium", quietStart: null, quietEnd: null, timezone: null })).status).toBe(400);
  });

  it("allows one endpoint across two companies and lists/renames the actor's devices", async () => {
    const a = await seedCompany("Mca");
    const b = await seedCompany("Mcb");
    const endpoint = "https://push.example/shared";
    const body = { endpoint, keys: { p256dh: "p", auth: "a" }, userAgent: "UA", label: "Phone" };

    const appA = await createApp(db, boardActor(a.id));
    const appB = await createApp(db, boardActor(b.id));
    expect((await request(appA).post(`/api/companies/${a.id}/push/subscriptions`).send(body)).status).toBe(200);
    expect((await request(appB).post(`/api/companies/${b.id}/push/subscriptions`).send(body)).status).toBe(200);

    // multi-company: same endpoint → one row per company
    const all = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(all).toHaveLength(2);

    // list is actor+company scoped
    const list = await request(appA).get(`/api/companies/${a.id}/push/subscriptions`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ label: "Phone", endpointTail: endpoint.slice(-8) });
    expect(list.body[0].id).toBeTruthy();

    // rename
    const id = list.body[0].id;
    expect((await request(appA).patch(`/api/companies/${a.id}/push/subscriptions/${id}`).send({ label: "Work phone" })).status).toBe(200);
    const renamed = await request(appA).get(`/api/companies/${a.id}/push/subscriptions`);
    expect(renamed.body[0].label).toBe("Work phone");

    // remove-by-id drops company A's row but leaves company B's (shared endpoint)
    expect((await request(appA).delete(`/api/companies/${a.id}/push/subscriptions/${id}`)).status).toBe(200);
    expect((await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))).length).toBe(1);
  });
});
// [END: module]
