/**
 * FILE: server/src/__tests__/access-instance-admin-actor-authz.test.ts
 * ABOUT: access-instance-admin-actor-authz.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - access-instance-admin-actor-authz.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: Prove the instance-admin routes authorise the credential, not the user row.
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/access-instance-admin-actor-authz.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  instanceUserRoles,
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

type Db = ReturnType<typeof createDb>;

/**
 * The actor the middleware would have built. The two cases that matter differ only in
 * provenance: same human, same instance_admin row in the database, different credential.
 */
async function createApp(db: Db, actor: Express.Request["actor"]) {
  process.env.PAPERCLIP_LOG_DIR = "/tmp/paperclip-test-home/logs";
  process.env.PAPERCLIP_IN_WORKTREE = "false";
  const { accessRoutes } = await import("../routes/access.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", accessRoutes(db, {
    deploymentMode: "authenticated",
    deploymentExposure: "private",
    bindHost: "127.0.0.1",
    allowedHostnames: [],
  }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message ?? "Internal server error" });
  });
  return app;
}

describeEmbeddedPostgres("instance-admin routes authorise the credential, not the user row", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-access-instance-admin-actor-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(companyMemberships);
    await db.delete(companies);
    await db.delete(instanceUserRoles);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  /**
   * A real instance admin: the user row and the instance_admin row both exist, and the user is
   * an active member of one company (which is what a Mini App session is scoped to).
   */
  async function createRealInstanceAdmin(db: Db) {
    const now = new Date();
    const userId = `admin-${randomUUID()}`;
    await db.insert(authUsers).values({
      id: userId,
      name: "Genuine Instance Admin",
      email: `${userId}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(instanceUserRoles).values({ userId, role: "instance_admin" });
    const company = await db
      .insert(companies)
      .values({
        name: `Instance Admin Actor ${randomUUID()}`,
        issuePrefix: `IA${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      })
      .returning()
      .then((rows) => rows[0]!);
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    return { userId, companyId: company.id };
  }

  function miniappActor(userId: string, companyId: string): Express.Request["actor"] {
    return {
      type: "board",
      userId,
      userName: "Genuine Instance Admin",
      userEmail: null,
      companyId,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "owner", status: "active" }],
      // The middleware hands Mini App sessions `false` on purpose, however admin the user is.
      isInstanceAdmin: false,
      source: "telegram_miniapp",
    };
  }

  function sessionActor(userId: string, companyId: string): Express.Request["actor"] {
    return {
      type: "board",
      userId,
      userName: "Genuine Instance Admin",
      userEmail: null,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "owner", status: "active" }],
      isInstanceAdmin: true,
      source: "session",
    };
  }

  it("refuses a telegram_miniapp bearer on GET /admin/users even though the user is a real instance admin", async () => {
    const { userId, companyId } = await createRealInstanceAdmin(db);

    const res = await request(await createApp(db, miniappActor(userId, companyId)))
      .get("/api/admin/users")
      .query({ query: "" });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toContain("Instance admin access required");
  }, 10_000);

  it("refuses a telegram_miniapp bearer on promote-instance-admin and writes no role row", async () => {
    const { userId, companyId } = await createRealInstanceAdmin(db);
    const now = new Date();
    const targetId = `target-${randomUUID()}`;
    await db.insert(authUsers).values({
      id: targetId,
      name: "Promotion Target",
      email: `${targetId}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });

    const res = await request(await createApp(db, miniappActor(userId, companyId)))
      .post(`/api/admin/users/${targetId}/promote-instance-admin`)
      .send({});

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const promoted = await db
      .select()
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, targetId), eq(instanceUserRoles.role, "instance_admin")));
    expect(promoted).toHaveLength(0);
  }, 10_000);

  it("still allows the same user through a browser session that carries the admin flag", async () => {
    const { userId, companyId } = await createRealInstanceAdmin(db);

    const res = await request(await createApp(db, sessionActor(userId, companyId)))
      .get("/api/admin/users")
      .query({ query: "" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.find((user: { id: string }) => user.id === userId)).toMatchObject({
      id: userId,
      isInstanceAdmin: true,
    });
  }, 10_000);
});
// [END: module]
