import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { companies, createDb, goals } from "@paperclipai/db";
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
    `Skipping stakeholder share route tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

type Db = ReturnType<typeof createDb>;

describeEmbeddedPostgres("stakeholder share routes", () => {
  let db: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId: string;
  let actor: Express.Request["actor"];

  function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    return app;
  }

  async function boardApp() {
    const [{ errorHandler }, { stakeholderShareRoutes }] = await Promise.all([
      import("../middleware/index.js"),
      import("../routes/stakeholder-shares.js"),
    ]);
    const app = makeApp();
    app.use("/api", stakeholderShareRoutes(db));
    app.use(errorHandler);
    return app;
  }

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-stakeholder-routes-");
    db = createDb(tempDb.connectionString);

    const [company] = await db
      .insert(companies)
      .values({ name: "Acme", issuePrefix: "ACM" })
      .returning();
    companyId = company!.id;

    await db.insert(goals).values([
      { companyId, title: "Reach 100 customers", level: "company", status: "active" },
    ]);

    actor = {
      type: "board",
      userId: "user-board-1",
      companyIds: [companyId],
      source: "local_implicit",
      isInstanceAdmin: true,
    } as Express.Request["actor"];
  }, 180_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createShare(body: Record<string, unknown> = { label: "Investors" }) {
    const app = await boardApp();
    const res = await request(app).post(`/api/companies/${companyId}/stakeholder-shares`).send(body);
    expect(res.status).toBe(200);
    return res.body as { id: string; token: string; tokenTail: string };
  }

  it("creates a share and returns the full token exactly once", async () => {
    const created = await createShare();
    expect(typeof created.token).toBe("string");
    expect(created.tokenTail).toBe(created.token.slice(-6));
  });

  it("omits the full token from the list response", async () => {
    const created = await createShare({ label: "Listed" });
    const app = await boardApp();
    const res = await request(app).get(`/api/companies/${companyId}/stakeholder-shares`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(created.token);
    expect(res.body.some((s: { id: string }) => s.id === created.id)).toBe(true);
  });

  it("rejects management routes for a non-board actor", async () => {
    const created = await createShare({ label: "Guarded" });
    const previous = actor;
    actor = {
      type: "agent",
      userId: "agent-1",
      companyIds: [companyId],
      source: "token",
      isInstanceAdmin: false,
    } as Express.Request["actor"];

    try {
      const app = await boardApp();
      // Bodies are valid so the request reaches the authorization check —
      // `validate()` sits ahead of `assertBoard` in the chain (repo-wide
      // convention), and a schema rejection would mask the 401/403 under test.
      const paths: Array<[string, string, Record<string, unknown>]> = [
        ["get", `/api/companies/${companyId}/stakeholder-shares`, {}],
        ["post", `/api/companies/${companyId}/stakeholder-shares`, { label: "Nope" }],
        ["patch", `/api/stakeholder-shares/${created.id}`, { label: "Nope" }],
        ["post", `/api/stakeholder-shares/${created.id}/revoke`, {}],
        ["post", `/api/stakeholder-shares/${created.id}/rotate`, {}],
      ];
      for (const [method, path, body] of paths) {
        const res = await (request(app) as never as Record<string, (p: string) => request.Test>)[method](path).send(body);
        expect([401, 403]).toContain(res.status);
      }
    } finally {
      actor = previous;
    }
  });

  it("serves the public page with no actor at all", async () => {
    const created = await createShare({ label: "Public", showGoalProgress: true });
    const previous = actor;
    actor = { type: "none", source: "none" } as Express.Request["actor"];

    try {
      const app = await boardApp();
      const res = await request(app).get(`/api/stakeholder/${created.token}`);
      expect(res.status).toBe(200);
      expect(res.body.companyName).toBe("Acme");
      expect(res.body.goalProgress.goals[0].title).toBe("Reach 100 customers");
    } finally {
      actor = previous;
    }
  });

  it("renders only the enabled sections", async () => {
    const created = await createShare({ label: "Curated", showGoalProgress: true });
    const app = await boardApp();
    const res = await request(app).get(`/api/stakeholder/${created.token}`);

    expect(res.status).toBe(200);
    expect("goalProgress" in res.body).toBe(true);
    expect("shippedWork" in res.body).toBe(false);
    expect("narrative" in res.body).toBe(false);
    expect("activityTimeline" in res.body).toBe(false);
  });

  it("404s an unknown token", async () => {
    const app = await boardApp();
    const res = await request(app).get("/api/stakeholder/definitely-not-a-token");
    expect(res.status).toBe(404);
  });

  it("404s a revoked token with the same body as an unknown one", async () => {
    const created = await createShare({ label: "Revoked" });
    const app = await boardApp();

    const unknown = await request(app).get("/api/stakeholder/definitely-not-a-token");
    await request(app).post(`/api/stakeholder-shares/${created.id}/revoke`).send({});
    const revoked = await request(app).get(`/api/stakeholder/${created.token}`);

    expect(revoked.status).toBe(404);
    // Identical response — the endpoint must not confirm that the token exists.
    expect(revoked.body).toEqual(unknown.body);
  });

  it("404s an expired token", async () => {
    const created = await createShare({
      label: "Expired",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const app = await boardApp();
    const res = await request(app).get(`/api/stakeholder/${created.token}`);
    expect(res.status).toBe(404);
  });

  it("invalidates the previous token on rotate", async () => {
    const created = await createShare({ label: "Rotated" });
    const app = await boardApp();

    const rotated = await request(app).post(`/api/stakeholder-shares/${created.id}/rotate`).send({});
    expect(rotated.status).toBe(200);
    expect(rotated.body.token).not.toBe(created.token);

    expect((await request(app).get(`/api/stakeholder/${created.token}`)).status).toBe(404);
    expect((await request(app).get(`/api/stakeholder/${rotated.body.token}`)).status).toBe(200);
  });

  it("applies toggle patches to the public payload", async () => {
    const created = await createShare({ label: "Patch" });
    const app = await boardApp();

    expect("goalProgress" in (await request(app).get(`/api/stakeholder/${created.token}`)).body).toBe(false);

    const patched = await request(app)
      .patch(`/api/stakeholder-shares/${created.id}`)
      .send({ showGoalProgress: true });
    expect(patched.status).toBe(200);

    expect("goalProgress" in (await request(app).get(`/api/stakeholder/${created.token}`)).body).toBe(true);
  });

  it("rejects an invalid create body", async () => {
    const app = await boardApp();
    const res = await request(app).post(`/api/companies/${companyId}/stakeholder-shares`).send({ label: "" });
    expect(res.status).toBe(400);
  });

  it("404s management of an unknown share id", async () => {
    const app = await boardApp();
    const missing = "00000000-0000-0000-0000-000000000000";
    expect((await request(app).patch(`/api/stakeholder-shares/${missing}`).send({ label: "x" })).status).toBe(404);
    expect((await request(app).post(`/api/stakeholder-shares/${missing}/revoke`).send({})).status).toBe(404);
    expect((await request(app).post(`/api/stakeholder-shares/${missing}/rotate`).send({})).status).toBe(404);
  });
});
