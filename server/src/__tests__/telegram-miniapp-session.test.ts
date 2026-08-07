import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { authUsers, companies, companyMemberships, createDb, telegramBotConfigs } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { telegramLinkService } from "../services/telegram-link.js";
import { telegramMiniappSessionService } from "../services/telegram-miniapp-session.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping Mini App session tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`);
}

const BOT_TOKEN = "123456789:AAHk9Xy_ZqL0pQrStUvWxYz1234567890abc";
const TG_USER = "77";
const NOW = new Date("2026-08-06T12:00:00.000Z");

function signInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
  const checkString = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

function initDataFor(telegramUserId: string, at = NOW, botToken = BOT_TOKEN): string {
  return signInitData(
    {
      auth_date: String(Math.floor(at.getTime() / 1000)),
      user: JSON.stringify({ id: Number(telegramUserId), first_name: "Dana" }),
    },
    botToken,
  );
}

describeEmbeddedPostgres("telegramMiniappSessionService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-miniapp-session-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE companies CASCADE`);
    // authUsers ("user") has no FK to companies, so it does not fall out of the cascade above --
    // seedBoardUser's fixed test ids would otherwise collide across tests that both seed a board user.
    await db.execute(sql`TRUNCATE TABLE "user" CASCADE`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name = "Acme") {
    return db
      .insert(companies)
      .values({ name, issuePrefix: `TG${Math.random().toString(36).slice(2, 6).toUpperCase()}` })
      .returning()
      .then((rows) => rows[0]!);
  }

  async function seedBot(companyId: string) {
    await db.insert(telegramBotConfigs).values({
      companyId,
      botToken: BOT_TOKEN,
      botUsername: "acme_ops_bot",
      webhookSecret: "hook-secret",
      enabled: true,
    });
  }

  async function seedBinding(
    companyId: string,
    userId: string,
    telegramUserId = TG_USER,
    chatId = "555",
    linkedAt?: Date,
  ) {
    const links = telegramLinkService(db);
    const { code } = await links.createLinkCode({ companyId, userId });
    const redeemed = await links.redeemLinkCode({ code, chatId, telegramUserId, now: linkedAt });
    if (!redeemed.ok) throw new Error("seed failed");
    return redeemed.binding;
  }

  // actorMiddleware's Mini App branch resolves through boardAuth.resolveBoardAccess, which is a real
  // lookup against `authUsers`/`companyMemberships` -- not just the Telegram binding. A binding alone
  // (as created by seedBinding above) is not enough to make the middleware treat the user as having
  // board access, by design: the session must narrow real access, not stand in for it.
  async function seedBoardUser(companyId: string, userId: string) {
    const now = new Date();
    await db.insert(authUsers).values({
      id: userId,
      name: "Board User",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "member",
    });
  }

  it("mints a session for a bound Telegram user", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);

    const result = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userId).toBe("user-board-1");
    expect(result.companyId).toBe(company.id);
    expect(result.token.length).toBeGreaterThanOrEqual(32);
    expect(result.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("resolves a minted token back to its session", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);
    const minted = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });
    if (!minted.ok) throw new Error("expected mint");

    const session = await svc.resolve(minted.token, NOW);

    expect(session?.userId).toBe("user-board-1");
    expect(session?.companyId).toBe(company.id);
  });

  it("never stores the token itself", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);
    const minted = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });
    if (!minted.ok) throw new Error("expected mint");

    const rows = await db.execute(sql`SELECT token_hash FROM telegram_miniapp_sessions`);
    const stored = (rows as unknown as { rows: { token_hash: string }[] }).rows ?? rows;
    expect(JSON.stringify(stored)).not.toContain(minted.token);
  });

  it("refuses a Telegram user with no binding for the company", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    const svc = telegramMiniappSessionService(db);

    const result = await svc.mint({ companyId: company.id, initData: initDataFor("999"), now: NOW });

    expect(result).toEqual({ ok: false, reason: "not_bound" });
  });

  it("refuses a binding that predates the recorded Telegram user id", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    const binding = await seedBinding(company.id, "user-board-1");
    await db.execute(sql`UPDATE telegram_chat_bindings SET telegram_user_id = NULL WHERE id = ${binding.id}`);
    const svc = telegramMiniappSessionService(db);

    const result = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });

    expect(result).toEqual({ ok: false, reason: "not_bound" });
  });

  it("refuses a tampered initData", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const params = new URLSearchParams(initDataFor(TG_USER));
    params.set("user", JSON.stringify({ id: 999, first_name: "Mallory" }));
    const svc = telegramMiniappSessionService(db);

    const result = await svc.mint({ companyId: company.id, initData: params.toString(), now: NOW });

    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a stale initData", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);
    const old = new Date(NOW.getTime() - 10 * 60_000);

    const result = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER, old), now: NOW });

    expect(result).toEqual({ ok: false, reason: "stale" });
  });

  it("refuses when the company has no bot configured", async () => {
    const company = await seedCompany();
    const svc = telegramMiniappSessionService(db);

    const result = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });

    expect(result).toEqual({ ok: false, reason: "no_bot" });
  });

  // The binding is per company, so a Telegram user bound to A must not reach B even though the
  // same person is behind both.
  it("cannot mint a session for a company the Telegram user is not bound to", async () => {
    const companyA = await seedCompany("A");
    const companyB = await seedCompany("B");
    await seedBot(companyA.id);
    await seedBot(companyB.id);
    await seedBinding(companyA.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);

    const result = await svc.mint({ companyId: companyB.id, initData: initDataFor(TG_USER), now: NOW });

    expect(result).toEqual({ ok: false, reason: "not_bound" });
  });

  it("does not resolve an expired session", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);
    const minted = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });
    if (!minted.ok) throw new Error("expected mint");

    const later = new Date(minted.expiresAt.getTime() + 1000);
    expect(await svc.resolve(minted.token, later)).toBeNull();
  });

  // "Unlink chat" on the board must remain a real kill switch.
  it("revokes live sessions when their binding is revoked", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    const binding = await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);
    const minted = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });
    if (!minted.ok) throw new Error("expected mint");
    expect(await svc.resolve(minted.token, NOW)).not.toBeNull();

    await telegramLinkService(db).revokeBinding({ companyId: company.id, id: binding.id });

    expect(await svc.resolve(minted.token, NOW)).toBeNull();
  });

  // "Disconnect bot" is the control an operator reaches for when a phone is stolen. Deleting the bot
  // config and revoking the bindings is only half of it: the sessions those bindings minted are what a
  // webview is actually holding, and they outlive the buttons by up to the full TTL unless revoked too.
  it("revokes live sessions when the bot is disconnected from the board", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { telegramRoutes } = await import("../routes/telegram.js");
    const { errorHandler } = await import("../middleware/index.js");

    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);
    const minted = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });
    if (!minted.ok) throw new Error("expected mint");
    expect(await svc.resolve(minted.token, NOW)).not.toBeNull();

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { actor: unknown }).actor = {
        type: "board",
        userId: "user-board-1",
        companyIds: [company.id],
        memberships: [{ companyId: company.id, membershipRole: "owner", status: "active" }],
        source: "session",
      };
      next();
    });
    app.use("/api", telegramRoutes(db));
    app.use(errorHandler);

    const res = await request(app).delete(`/api/companies/${company.id}/telegram/config`);
    expect(res.status).toBe(200);

    expect(await svc.resolve(minted.token, NOW)).toBeNull();
  });

  // Re-linking a chat supersedes the prior binding. That is a revocation too, and the superseded
  // user's Mini App session has to go with it -- otherwise handing a chat to a colleague leaves the
  // previous operator's webview acting as themselves for hours.
  it("revokes live sessions when the chat is re-linked to another user", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1", TG_USER, "555");
    const svc = telegramMiniappSessionService(db);
    const minted = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });
    if (!minted.ok) throw new Error("expected mint");
    expect(await svc.resolve(minted.token, NOW)).not.toBeNull();

    // Same chat, a code issued by a different board user: the old binding is superseded.
    await seedBinding(company.id, "user-board-2", TG_USER, "555");

    expect(await svc.resolve(minted.token, NOW)).toBeNull();
  });

  // `enabled: false` already blocks minting. Left at that, it would mean "off for new sessions only".
  it("stops resolving sessions once the company's bot is disabled", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);
    const minted = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });
    if (!minted.ok) throw new Error("expected mint");
    expect(await svc.resolve(minted.token, NOW)).not.toBeNull();

    await db
      .update(telegramBotConfigs)
      .set({ enabled: false })
      .where(eq(telegramBotConfigs.companyId, company.id));

    expect(await svc.resolve(minted.token, NOW)).toBeNull();
  });

  it("stops resolving sessions once the company's bot config is deleted outright", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);
    const minted = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });
    if (!minted.ok) throw new Error("expected mint");

    await db.delete(telegramBotConfigs).where(eq(telegramBotConfigs.companyId, company.id));

    expect(await svc.resolve(minted.token, NOW)).toBeNull();
  });

  // (companyId, telegramUserId) is not unique -- the live-binding unique index is (companyId, chatId).
  // One Telegram account that redeemed codes issued by two different board users in the same company
  // therefore has two live bindings naming two different Paperclip identities, and an unordered
  // `select ... limit 1` would let Postgres pick whose identity the session assumes.
  it("refuses to mint when two live bindings name different Paperclip users", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1", TG_USER, "chat-a");
    await seedBinding(company.id, "user-board-2", TG_USER, "chat-b");
    const svc = telegramMiniappSessionService(db);

    const result = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });

    expect(result).toEqual({ ok: false, reason: "ambiguous_binding" });
  });

  // Two chats, one operator: no ambiguity about *who*, so this must still work -- and must attach to
  // the most recently linked binding, so a later unlink of that chat is what kills the session.
  it("mints deterministically against the newest binding when both name the same user", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1", TG_USER, "chat-a", new Date(NOW.getTime() - 60_000));
    const newest = await seedBinding(company.id, "user-board-1", TG_USER, "chat-b", NOW);
    const svc = telegramMiniappSessionService(db);

    const result = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userId).toBe("user-board-1");
    const session = await svc.resolve(result.token, NOW);
    expect(session?.bindingId).toBe(newest.id);
  });

  it("resolves a minted token to a board actor scoped to one company", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { actorMiddleware } = await import("../middleware/auth.js");

    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    await seedBoardUser(company.id, "user-board-1");
    const minted = await telegramMiniappSessionService(db).mint({
      companyId: company.id,
      initData: initDataFor(TG_USER),
      now: NOW,
    });
    if (!minted.ok) throw new Error("expected mint");

    const app = express();
    app.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    app.get("/whoami", (req, res) => res.json(req.actor));

    const res = await request(app).get("/whoami").set("authorization", `Bearer ${minted.token}`);

    expect(res.body.type).toBe("board");
    expect(res.body.userId).toBe("user-board-1");
    expect(res.body.source).toBe("telegram_miniapp");
    expect(res.body.companyIds).toEqual([company.id]);
  });

  it("does not authenticate a revoked session", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { actorMiddleware } = await import("../middleware/auth.js");

    const company = await seedCompany();
    await seedBot(company.id);
    const binding = await seedBinding(company.id, "user-board-1");
    const minted = await telegramMiniappSessionService(db).mint({
      companyId: company.id,
      initData: initDataFor(TG_USER),
      now: NOW,
    });
    if (!minted.ok) throw new Error("expected mint");
    await telegramLinkService(db).revokeBinding({ companyId: company.id, id: binding.id });

    const app = express();
    app.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    app.get("/whoami", (req, res) => res.json(req.actor));

    const res = await request(app).get("/whoami").set("authorization", `Bearer ${minted.token}`);

    expect(res.body.type).toBe("none");
  });

  // The narrowing guard is the whole point of this branch: a live session must still be refused if
  // the user it points at no longer genuinely has access to the session's company. This is the one
  // path where a regression would *widen* access instead of denying it.
  it("does not authenticate when the user's membership in the session's company is gone", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { actorMiddleware } = await import("../middleware/auth.js");

    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    await seedBoardUser(company.id, "user-board-1");
    const minted = await telegramMiniappSessionService(db).mint({
      companyId: company.id,
      initData: initDataFor(TG_USER),
      now: NOW,
    });
    if (!minted.ok) throw new Error("expected mint");

    // The Mini App session is still live and the Telegram binding is untouched, but the user's
    // board membership for this company was deactivated after the session was minted -- e.g. they
    // were removed from the company. resolveBoardAccess must drop this company out of
    // access.companyIds, and the middleware's `.includes()` guard must refuse to grant a board
    // actor rather than falling back to some wider set of companies.
    await db
      .update(companyMemberships)
      .set({ status: "inactive" })
      .where(
        and(eq(companyMemberships.companyId, company.id), eq(companyMemberships.principalId, "user-board-1")),
      );

    const app = express();
    app.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    app.get("/whoami", (req, res) => res.json(req.actor));

    const res = await request(app).get("/whoami").set("authorization", `Bearer ${minted.token}`);

    expect(res.body.type).toBe("none");
    expect(res.body.source).toBe("none");
    expect(res.body.companyIds).toBeUndefined();
  });
});
