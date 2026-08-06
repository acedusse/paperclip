/**
 * FILE: server/src/__tests__/telegram-routes.test.ts
 * ABOUT: telegram-routes.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - route tests for Telegram bot config, chat linking, and the inbound webhook.
 */
// ==========================================
// [META: module]
// INTENT: Cover the board-facing setup surface (token never readable, codes issued, bindings revocable)
//   and the untrusted webhook: secret-token verification, /start redemption, and inline-button decisions.
// PSEUDOCODE: 1. Board app with a stub actor for config/link routes. 2. Webhook app with no actor at all,
//   posting Telegram Update bodies. 3. Assert DB effects and what the bot was asked to send back.
// JSON_FLOW: {"file": "server/src/__tests__/telegram-routes.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  activityLog,
  approvals,
  companies,
  createDb,
  telegramBotConfigs,
  telegramChatBindings,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { encodeApprovalCallback } from "../services/telegram-format.js";
import { telegramLinkService } from "../services/telegram-link.js";
import type { TelegramSendMessage, TelegramTransport } from "../services/telegram-transport.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping telegram route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

type Db = ReturnType<typeof createDb>;
const BOT_TOKEN = "123456789:AAHk9Xy_ZqL0pQrStUvWxYz1234567890abc";
const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";
/**
 * The Telegram account that redeems the link code in these tests. Deliberately distinct from the chat
 * id ("555"): authority follows the user, not the room the card is sitting in.
 */
const BOUND_TG_USER = "77";

function boardActor(companyId: string): Express.Request["actor"] {
  return {
    type: "board",
    userId: "user-board-1",
    companyIds: [companyId],
    source: "local_implicit",
    isInstanceAdmin: true,
  } as Express.Request["actor"];
}

describeEmbeddedPostgres("telegram routes", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let sent: TelegramSendMessage[];
  let answered: { callbackQueryId: string; text: string }[];
  let edited: { chatId: string; messageId: number }[];
  let transport: TelegramTransport;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-telegram-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  beforeEach(() => {
    sent = [];
    answered = [];
    edited = [];
    transport = {
      async sendMessage(input) {
        sent.push(input);
      },
      async answerCallbackQuery(input) {
        answered.push({ callbackQueryId: input.callbackQueryId, text: input.text });
      },
      async editMessageReplyMarkup(input) {
        edited.push({ chatId: input.chatId, messageId: input.messageId });
      },
      async setChatMenuButton() {},
    };
  });

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(approvals);
    await db.delete(telegramChatBindings);
    await db.delete(telegramBotConfigs);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createApp(actor: Express.Request["actor"] | null) {
    const [{ errorHandler }, { telegramRoutes }] = await Promise.all([
      import("../middleware/index.js"),
      import("../routes/telegram.js"),
    ]);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = (actor ?? { type: "none", source: "none" }) as Express.Request["actor"];
      next();
    });
    app.use("/api", telegramRoutes(db, { transport }));
    app.use(errorHandler);
    return app;
  }

  async function seedCompany() {
    return db
      .insert(companies)
      .values({ name: "TG Co", issuePrefix: `TG${Math.random().toString(36).slice(2, 6).toUpperCase()}` })
      .returning()
      .then((rows) => rows[0]!);
  }

  async function seedConfig(companyId: string, secret = "hook-secret") {
    await db.insert(telegramBotConfigs).values({
      companyId,
      botToken: BOT_TOKEN,
      botUsername: "tgco_bot",
      webhookSecret: secret,
      enabled: true,
    });
  }

  async function seedApproval(companyId: string) {
    return db
      .insert(approvals)
      .values({ companyId, type: "request_board_approval", status: "pending", payload: {} })
      .returning()
      .then((rows) => rows[0]!);
  }

  describe("board configuration", () => {
    it("stores a bot registration and mints a webhook secret", async () => {
      const company = await seedCompany();
      const app = await createApp(boardActor(company.id));

      const res = await request(app)
        .put(`/api/companies/${company.id}/telegram/config`)
        .send({ botToken: BOT_TOKEN, botUsername: "tgco_bot" });

      expect(res.status).toBe(200);
      const [row] = await db.select().from(telegramBotConfigs).where(eq(telegramBotConfigs.companyId, company.id));
      expect(row!.botToken).toBe(BOT_TOKEN);
      expect(row!.webhookSecret.length).toBeGreaterThanOrEqual(16);
    });

    it("never returns the bot token to a reader", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const app = await createApp(boardActor(company.id));

      const res = await request(app).get(`/api/companies/${company.id}/telegram/config`);

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(BOT_TOKEN);
      expect(res.body.configured).toBe(true);
      expect(res.body.botUsername).toBe("tgco_bot");
    });

    it("reports an unconfigured company as not configured", async () => {
      const company = await seedCompany();
      const app = await createApp(boardActor(company.id));

      const res = await request(app).get(`/api/companies/${company.id}/telegram/config`);

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(false);
    });

    it("refuses a non-board actor", async () => {
      const company = await seedCompany();
      const app = await createApp(null);

      const res = await request(app)
        .put(`/api/companies/${company.id}/telegram/config`)
        .send({ botToken: BOT_TOKEN });

      expect([401, 403]).toContain(res.status);
    });

    it("removes the registration and its bindings on delete", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      const app = await createApp(boardActor(company.id));

      const res = await request(app).delete(`/api/companies/${company.id}/telegram/config`);

      expect(res.status).toBe(200);
      expect(await db.select().from(telegramBotConfigs).where(eq(telegramBotConfigs.companyId, company.id))).toHaveLength(0);
      expect(await links.listBindings(company.id)).toHaveLength(0);
    });
  });

  describe("chat linking", () => {
    it("issues a one-time code with a deep link into the bot", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const app = await createApp(boardActor(company.id));

      const res = await request(app).post(`/api/companies/${company.id}/telegram/link-codes`).send({});

      expect(res.status).toBe(201);
      expect(res.body.code).toBeTruthy();
      expect(res.body.deepLink).toBe(`https://t.me/tgco_bot?start=${res.body.code}`);
    });

    it("refuses to issue a code before a bot is configured", async () => {
      const company = await seedCompany();
      const app = await createApp(boardActor(company.id));

      const res = await request(app).post(`/api/companies/${company.id}/telegram/link-codes`).send({});

      expect(res.status).toBe(409);
    });

    it("lists live bindings and drops them on revoke", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      const app = await createApp(boardActor(company.id));

      const listed = await request(app).get(`/api/companies/${company.id}/telegram/bindings`);
      expect(listed.body).toHaveLength(1);

      const revoked = await request(app).delete(
        `/api/companies/${company.id}/telegram/bindings/${listed.body[0].id}`,
      );
      expect(revoked.status).toBe(200);
      expect((await request(app).get(`/api/companies/${company.id}/telegram/bindings`)).body).toHaveLength(0);
    });
  });

  describe("inbound webhook", () => {
    function callbackUpdate(
      approvalId: string,
      outcome: "approve" | "reject",
      chatId = "555",
      fromTelegramUserId: string | null = BOUND_TG_USER,
    ) {
      return {
        update_id: 1,
        callback_query: {
          id: "cb-1",
          data: encodeApprovalCallback({ approvalId, outcome }),
          message: { message_id: 42, chat: { id: Number(chatId) } },
          ...(fromTelegramUserId === null ? {} : { from: { id: Number(fromTelegramUserId) } }),
        },
      };
    }

    it("rejects a delivery with no secret token", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const approval = await seedApproval(company.id);
      const app = await createApp(null);

      const res = await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .send(callbackUpdate(approval.id, "approve"));

      expect(res.status).toBe(401);
      const [row] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
      expect(row!.status).toBe("pending");
    });

    it("rejects a delivery with the wrong secret token", async () => {
      const company = await seedCompany();
      await seedConfig(company.id, "the-real-secret");
      const approval = await seedApproval(company.id);
      const app = await createApp(null);

      const res = await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "not-the-secret")
        .send(callbackUpdate(approval.id, "approve"));

      expect(res.status).toBe(401);
      const [row] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
      expect(row!.status).toBe("pending");
    });

    it("404s for a company with no bot configured", async () => {
      const company = await seedCompany();
      const app = await createApp(null);

      const res = await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "hook-secret")
        .send({ update_id: 1 });

      expect(res.status).toBe(404);
    });

    it("approves the approval when a bound chat taps Approve", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const approval = await seedApproval(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      const app = await createApp(null);

      const res = await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "hook-secret")
        .send(callbackUpdate(approval.id, "approve"));

      expect(res.status).toBe(200);
      const [row] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
      expect(row!.status).toBe("approved");
      expect(row!.decidedByUserId).toBe("user-board-1");
    });

    // The group-chat hole: a bound chat is readable and tappable by everyone in it, so the chat alone
    // must never confer authority. Only the account that redeemed the code may decide.
    it("refuses a tap from a different member of the bound chat, leaving the approval pending", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const approval = await seedApproval(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      const app = await createApp(null);

      const res = await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "hook-secret")
        // Same chat, same card — a different Telegram account pressing the button.
        .send(callbackUpdate(approval.id, "approve", "555", "999"));

      expect(res.status).toBe(200);
      const [row] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
      expect(row!.status).toBe("pending");
      expect(answered[0]!.text).toMatch(/only the person who linked/i);
      // The card stays live: the bound user has not decided yet.
      expect(edited).toEqual([]);
    });

    it("refuses a tap that carries no sender at all", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const approval = await seedApproval(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      const app = await createApp(null);

      await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "hook-secret")
        .send(callbackUpdate(approval.id, "approve", "555", null));

      const [row] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
      expect(row!.status).toBe("pending");
    });

    // Bindings made before migration 0125 have no recorded Telegram user. Treating "unknown" as
    // "allowed" would preserve the hole, so they fail closed until the chat re-links.
    it("refuses a tap on a binding that predates the recorded user identity", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const approval = await seedApproval(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      // Simulate a row written by the pre-0125 code path.
      await db
        .update(telegramChatBindings)
        .set({ telegramUserId: null })
        .where(eq(telegramChatBindings.companyId, company.id));
      const app = await createApp(null);

      await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "hook-secret")
        .send(callbackUpdate(approval.id, "approve"));

      const [row] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
      expect(row!.status).toBe("pending");
      expect(answered[0]!.text).toMatch(/re-link/i);
    });

    // Group clients send `/start@yourbot <code>`, which is exactly how a shared ops chat gets linked.
    it("redeems a code sent as the group form of the command", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      const app = await createApp(null);

      await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "hook-secret")
        .send({
          update_id: 2,
          message: {
            message_id: 7,
            chat: { id: 555 },
            from: { id: Number(BOUND_TG_USER) },
            text: `/start@tgco_bot ${code}`,
          },
        });

      const bindings = await links.listBindings(company.id);
      expect(bindings.map((b) => b.chatId)).toEqual(["555"]);
      expect(bindings[0]!.telegramUserId).toBe(BOUND_TG_USER);
    });

    it("ignores a command that merely starts with the same characters", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      const app = await createApp(null);

      const res = await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "hook-secret")
        .send({
          update_id: 2,
          message: { message_id: 7, chat: { id: 555 }, from: { id: 77 }, text: `/startle ${code}` },
        });

      expect(res.status).toBe(200);
      expect(await links.listBindings(company.id)).toHaveLength(0);
      expect(sent).toHaveLength(0);
    });

    it("records the sender's Telegram id when a chat redeems a code", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      const app = await createApp(null);

      await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "hook-secret")
        .send({
          update_id: 2,
          message: { message_id: 7, chat: { id: 555 }, from: { id: Number(BOUND_TG_USER) }, text: `/start ${code}` },
        });

      const [binding] = await links.listBindings(company.id);
      expect(binding!.telegramUserId).toBe(BOUND_TG_USER);
    });

    it("acknowledges the tap and retires the buttons", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const approval = await seedApproval(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      const app = await createApp(null);

      await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "hook-secret")
        .send(callbackUpdate(approval.id, "approve"));

      expect(answered).toEqual([{ callbackQueryId: "cb-1", text: "Approved" }]);
      expect(edited).toEqual([{ chatId: "555", messageId: 42 }]);
    });

    it("retires the buttons on a message whose approval was already decided elsewhere", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const approval = await seedApproval(company.id);
      await db.update(approvals).set({ status: "rejected" }).where(eq(approvals.id, approval.id));
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      const app = await createApp(null);

      await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "hook-secret")
        .send(callbackUpdate(approval.id, "approve"));

      expect(answered[0]!.text).toMatch(/already rejected/i);
      expect(edited).toEqual([{ chatId: "555", messageId: 42 }]);
    });

    it("does not decide for a chat that was never linked", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const approval = await seedApproval(company.id);
      const app = await createApp(null);

      const res = await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "hook-secret")
        .send(callbackUpdate(approval.id, "approve"));

      expect(res.status).toBe(200);
      const [row] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
      expect(row!.status).toBe("pending");
      expect(answered[0]!.text).toMatch(/not linked/i);
    });

    it("binds the chat when it sends a valid /start code", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      const app = await createApp(null);

      const res = await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "hook-secret")
        .send({ update_id: 2, message: { message_id: 7, chat: { id: 555 }, from: { id: Number(BOUND_TG_USER) }, text: `/start ${code}` } });

      expect(res.status).toBe(200);
      expect((await links.listBindings(company.id)).map((b) => b.chatId)).toEqual(["555"]);
      expect(sent[0]!.text).toContain("TG Co");
    });

    it("does not bind on an unknown /start code", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const app = await createApp(null);

      await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "hook-secret")
        .send({ update_id: 2, message: { message_id: 7, chat: { id: 555 }, from: { id: Number(BOUND_TG_USER) }, text: "/start bogus" } });

      expect(await telegramLinkService(db).listBindings(company.id)).toHaveLength(0);
      expect(sent[0]!.text).toMatch(/link code/i);
    });

    it("acknowledges an update it does not handle without failing the delivery", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const app = await createApp(null);

      const res = await request(app)
        .post(`/api/telegram/webhook/${company.id}`)
        .set(WEBHOOK_SECRET_HEADER, "hook-secret")
        .send({ update_id: 3, edited_message: { message_id: 9, chat: { id: 555 }, text: "hi" } });

      expect(res.status).toBe(200);
      expect(sent).toHaveLength(0);
    });
  });

  describe("mini app session", () => {
    function signInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
      const checkString = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
      const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
      const hash = createHmac("sha256", secret).update(checkString).digest("hex");
      return new URLSearchParams({ ...fields, hash }).toString();
    }

    function freshInitData(telegramUserId = BOUND_TG_USER): string {
      return signInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: Number(telegramUserId), first_name: "Dana" }),
      });
    }

    it("mints a session for a bound Telegram user", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      const app = await createApp(null);

      const res = await request(app)
        .post("/api/telegram/miniapp/session")
        .send({ companyId: company.id, initData: freshInitData() });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.userId).toBe("user-board-1");
      expect(res.body.companyId).toBe(company.id);
      expect(typeof res.body.token).toBe("string");
    });

    it("refuses an unbound Telegram user", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const app = await createApp(null);

      const res = await request(app)
        .post("/api/telegram/miniapp/session")
        .send({ companyId: company.id, initData: freshInitData("99999") });

      expect(res.status).toBe(401);
    });

    it("refuses a tampered initData", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      const params = new URLSearchParams(freshInitData());
      params.set("user", JSON.stringify({ id: 999, first_name: "Mallory" }));
      const app = await createApp(null);

      const res = await request(app)
        .post("/api/telegram/miniapp/session")
        .send({ companyId: company.id, initData: params.toString() });

      expect(res.status).toBe(401);
    });

    // The security property here is not "these fail" (already covered above) but that they fail
    // *identically*. An unauthenticated caller must not be able to distinguish "wrong user" from
    // "forged signature" from "expired signature" -- if a future edit made the messages reason-specific
    // while keeping every status at 401, per-case status assertions alone would not catch it.
    it("gives indistinguishable responses across different unauthenticated failure reasons", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      const app = await createApp(null);

      const unboundUser = await request(app)
        .post("/api/telegram/miniapp/session")
        .send({ companyId: company.id, initData: freshInitData("99999") });

      const tamperedParams = new URLSearchParams(freshInitData());
      tamperedParams.set("user", JSON.stringify({ id: 999, first_name: "Mallory" }));
      const tamperedSignature = await request(app)
        .post("/api/telegram/miniapp/session")
        .send({ companyId: company.id, initData: tamperedParams.toString() });

      const staleInitData = signInitData({
        auth_date: String(Math.floor(Date.now() / 1000) - 3600),
        user: JSON.stringify({ id: Number(BOUND_TG_USER), first_name: "Dana" }),
      });
      const staleSignature = await request(app)
        .post("/api/telegram/miniapp/session")
        .send({ companyId: company.id, initData: staleInitData });

      const disclosureFailure =
        "an unauthenticated caller must not be able to tell 'not bound' apart from 'bad signature' " +
        "apart from 'stale' -- status and body must match across every refusal reason";
      expect(unboundUser.status, disclosureFailure).toBe(401);
      expect(tamperedSignature.status, disclosureFailure).toBe(401);
      expect(staleSignature.status, disclosureFailure).toBe(401);
      expect(tamperedSignature.body, disclosureFailure).toEqual(unboundUser.body);
      expect(staleSignature.body, disclosureFailure).toEqual(unboundUser.body);
      expect(unboundUser.body).toEqual({ error: "Could not authenticate this Telegram session" });
    });

    it("404s for a company with no bot", async () => {
      const company = await seedCompany();
      const app = await createApp(null);

      const res = await request(app)
        .post("/api/telegram/miniapp/session")
        .send({ companyId: company.id, initData: freshInitData() });

      expect(res.status).toBe(404);
    });

    it("never echoes the bot token", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      const app = await createApp(null);

      const res = await request(app)
        .post("/api/telegram/miniapp/session")
        .send({ companyId: company.id, initData: freshInitData() });

      expect(JSON.stringify(res.body)).not.toContain(BOT_TOKEN);
    });
  });
});
// [END: module]
