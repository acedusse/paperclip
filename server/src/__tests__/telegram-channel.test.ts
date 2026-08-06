/**
 * FILE: server/src/__tests__/telegram-channel.test.ts
 * ABOUT: telegram-channel.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - DB-backed tests for the outbound Telegram delivery channel.
 */
// ==========================================
// [META: module]
// INTENT: Verify the telegram channel only sends when a company has an enabled bot and a live chat
//   binding, that it honours the same risk-band floor as web push, and that one failed chat does not
//   suppress the rest.
// PSEUDOCODE: 1. Seed company + bot config + bindings. 2. Deliver payloads through a recording
//   transport. 3. Assert on what was sent, to which chat, with which bot token and keyboard.
// JSON_FLOW: {"file": "server/src/__tests__/telegram-channel.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import {
  assets,
  companies,
  createDb,
  issueApprovals,
  issueAttachments,
  issues,
  approvals,
  pushDeliveryPrefs,
  telegramBotConfigs,
  telegramChatBindings,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { createTelegramChannel } from "../services/telegram-channel.js";
import { decodeApprovalCallback } from "../services/telegram-format.js";
import { telegramLinkService } from "../services/telegram-link.js";
import type { NotificationPayload } from "../services/notification-delivery.js";
import type {
  TelegramSendMedia,
  TelegramSendMessage,
  TelegramTransport,
  TelegramUploadFile,
} from "../services/telegram-transport.js";
import type { StorageService } from "../storage/types.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping telegram channel tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const APPROVAL_ID = "6f1d5b9c-2a4e-4c3f-9b7a-1d2e3f4a5b6c";

function approvalPayload(band = "critical"): NotificationPayload {
  return {
    kind: "approval_high_risk",
    title: `${band} risk approval needs you`,
    push: {
      title: `${band} risk approval`,
      body: "budget_override_required — tap to review",
      url: `/approvals/${APPROVAL_ID}`,
      tag: `approval-${APPROVAL_ID}`,
      band,
      approvalId: APPROVAL_ID,
    },
  };
}

describeEmbeddedPostgres("createTelegramChannel", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let sent: TelegramSendMessage[];
  let photos: TelegramSendMedia[];
  let documents: TelegramSendMedia[];
  let albums: { chatId: string; files: TelegramUploadFile[] }[];
  let failFor: Set<string>;
  let transport: TelegramTransport;
  let storage: StorageService;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("telegram-channel");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  }, 30_000);

  beforeEachTransport();

  function beforeEachTransport() {
    sent = [];
    photos = [];
    documents = [];
    albums = [];
    failFor = new Set<string>();
    transport = {
      async sendMessage(input) {
        if (failFor.has(input.chatId)) throw new Error("chat blocked the bot");
        sent.push(input);
      },
      async answerCallbackQuery() {},
      async editMessageReplyMarkup() {},
      async sendPhoto(input) {
        if (failFor.has(input.chatId)) throw new Error("chat blocked the bot");
        photos.push(input);
      },
      async sendDocument(input) {
        if (failFor.has(input.chatId)) throw new Error("chat blocked the bot");
        documents.push(input);
      },
      async sendMediaGroup(input) {
        if (failFor.has(input.chatId)) throw new Error("chat blocked the bot");
        albums.push({ chatId: input.chatId, files: input.files });
      },
    };
    storage = {
      provider: "local",
      putFile: async () => {
        throw new Error("not used");
      },
      getObject: async (_companyId: string, objectKey: string) => ({
        stream: Readable.from([Buffer.from(`bytes-for-${objectKey}`)]),
      }),
      headObject: async () => ({ exists: true }),
      deleteObject: async () => {},
    } as unknown as StorageService;
  }

  afterEach(async () => {
    beforeEachTransport();
    await db.delete(telegramChatBindings);
    await db.delete(telegramBotConfigs);
    await db.delete(pushDeliveryPrefs);
    await db.delete(issueAttachments);
    await db.delete(issueApprovals);
    await db.delete(assets);
    await db.delete(issues);
    await db.delete(approvals);
    await db.delete(companies);
  });

  afterAll(async () => {
    await stopDb?.();
  });

  async function seedCompany(): Promise<string> {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Acme",
      issuePrefix: `T${companyId.slice(0, 7)}`.toUpperCase(),
      status: "active",
    });
    return companyId;
  }

  async function seedBot(companyId: string, overrides: { enabled?: boolean; publicBaseUrl?: string } = {}) {
    await db.insert(telegramBotConfigs).values({
      companyId,
      botToken: "bot-token-123",
      botUsername: "acme_ops_bot",
      webhookSecret: "hook-secret",
      publicBaseUrl: overrides.publicBaseUrl ?? null,
      enabled: overrides.enabled ?? true,
    });
  }

  async function seedBinding(companyId: string, chatId: string, userId: string) {
    const link = telegramLinkService(db);
    const { code } = await link.createLinkCode({ companyId, userId });
    await link.redeemLinkCode({ code, chatId });
  }

  it("sends the approval to every live chat bound to the company", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");
    await seedBinding(companyId, "222", "user-2");

    await createTelegramChannel(db, { transport }).deliver({ companyId }, approvalPayload());

    expect(sent.map((s) => s.chatId).sort()).toEqual(["111", "222"]);
  });

  it("sends with the company's own bot token", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");

    await createTelegramChannel(db, { transport }).deliver({ companyId }, approvalPayload());

    expect(sent[0]!.botToken).toBe("bot-token-123");
  });

  it("attaches Approve and Reject buttons carrying the approval id", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");

    await createTelegramChannel(db, { transport }).deliver({ companyId }, approvalPayload());

    const row = sent[0]!.replyMarkup!.inline_keyboard[0]!;
    expect(decodeApprovalCallback(row[0]!.callback_data)).toEqual({ approvalId: APPROVAL_ID, outcome: "approve" });
    expect(decodeApprovalCallback(row[1]!.callback_data)).toEqual({ approvalId: APPROVAL_ID, outcome: "reject" });
  });

  it("does not send when the company has no bot configured", async () => {
    const companyId = await seedCompany();
    await seedBinding(companyId, "111", "user-1");

    await createTelegramChannel(db, { transport }).deliver({ companyId }, approvalPayload());

    expect(sent).toHaveLength(0);
  });

  it("does not send when the bot is disabled", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId, { enabled: false });
    await seedBinding(companyId, "111", "user-1");

    await createTelegramChannel(db, { transport }).deliver({ companyId }, approvalPayload());

    expect(sent).toHaveLength(0);
  });

  it("does not send to a revoked chat", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");
    const link = telegramLinkService(db);
    const [binding] = await link.listBindings(companyId);
    await link.revokeBinding({ companyId, id: binding!.id });

    await createTelegramChannel(db, { transport }).deliver({ companyId }, approvalPayload());

    expect(sent).toHaveLength(0);
  });

  it("ignores payloads that carry no approval push", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");

    await createTelegramChannel(db, { transport }).deliver(
      { companyId },
      { kind: "digest", title: "Daily digest" },
    );

    expect(sent).toHaveLength(0);
  });

  it("sends nothing rather than dead buttons when the payload names no approval", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");
    const payload = approvalPayload();
    delete payload.push!.approvalId;

    await createTelegramChannel(db, { transport }).deliver({ companyId }, payload);

    expect(sent).toHaveLength(0);
  });

  it("honours a user's minimum risk band", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");
    await db.insert(pushDeliveryPrefs).values({
      companyId,
      userId: "user-1",
      minBand: "critical",
      quietStart: null,
      quietEnd: null,
      timezone: null,
    });

    await createTelegramChannel(db, { transport }).deliver({ companyId }, approvalPayload("high"));

    expect(sent).toHaveLength(0);
  });

  it("keeps delivering to other chats when one chat rejects the bot", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");
    await seedBinding(companyId, "222", "user-2");
    failFor.add("111");

    await createTelegramChannel(db, { transport }).deliver({ companyId }, approvalPayload());

    expect(sent.map((s) => s.chatId)).toEqual(["222"]);
  });

  it("includes a deep link when the company set a public base URL", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId, { publicBaseUrl: "https://ops.example.com" });
    await seedBinding(companyId, "111", "user-1");

    await createTelegramChannel(db, { transport }).deliver({ companyId }, approvalPayload());

    const linkRow = sent[0]!.replyMarkup!.inline_keyboard[1]!;
    expect(linkRow[0]!.url).toBe(`https://ops.example.com/approvals/${APPROVAL_ID}`);
  });

  // ---- rich media -----------------------------------------------------------

  async function seedApprovalWithAttachments(
    companyId: string,
    files: { contentType: string; filename: string; byteSize?: number }[],
  ) {
    await db.insert(approvals).values({
      id: APPROVAL_ID,
      companyId,
      type: "request_board_approval",
      status: "pending",
      payload: {},
    });
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Ship the dashboard",
      description: "",
      status: "in_progress",
      priority: "medium",
      identifier: "PAP-14",
    });
    await db.insert(issueApprovals).values({ companyId, issueId, approvalId: APPROVAL_ID });
    for (const file of files) {
      const assetId = randomUUID();
      await db.insert(assets).values({
        id: assetId,
        companyId,
        provider: "local_disk",
        objectKey: `key-${file.filename}`,
        contentType: file.contentType,
        byteSize: file.byteSize ?? 2048,
        sha256: `sha-${file.filename}`,
        originalFilename: file.filename,
      });
      await db.insert(issueAttachments).values({ companyId, issueId, assetId });
    }
    return issueId;
  }

  it("sends a lone screenshot as a photo carrying the approval card and controls", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");
    await seedApprovalWithAttachments(companyId, [{ contentType: "image/png", filename: "shot.png" }]);

    await createTelegramChannel(db, { transport, storage }).deliver({ companyId }, approvalPayload());

    expect(photos).toHaveLength(1);
    expect(photos[0]!.file.filename).toBe("shot.png");
    expect(photos[0]!.caption).toContain("critical risk approval");
    expect(photos[0]!.parseMode).toBe("HTML");
    expect(decodeApprovalCallback(photos[0]!.replyMarkup!.inline_keyboard[0]![0]!.callback_data)).toEqual({
      approvalId: APPROVAL_ID,
      outcome: "approve",
    });
    expect(sent).toHaveLength(0);
  });

  it("sends several screenshots as one album followed by the controls", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");
    await seedApprovalWithAttachments(companyId, [
      { contentType: "image/png", filename: "a.png" },
      { contentType: "image/jpeg", filename: "b.jpg" },
    ]);

    await createTelegramChannel(db, { transport, storage }).deliver({ companyId }, approvalPayload());

    expect(albums).toHaveLength(1);
    expect(albums[0]!.files.map((f) => f.filename).sort()).toEqual(["a.png", "b.jpg"]);
    // A media group takes no reply_markup, so the controls must follow in their own message.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.replyMarkup!.inline_keyboard[0]).toHaveLength(2);
  });

  it("sends a vector diagram as a document because Telegram cannot render it as a photo", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");
    await seedApprovalWithAttachments(companyId, [{ contentType: "image/svg+xml", filename: "arch.svg" }]);

    await createTelegramChannel(db, { transport, storage }).deliver({ companyId }, approvalPayload());

    expect(documents).toHaveLength(1);
    expect(documents[0]!.file.filename).toBe("arch.svg");
    expect(photos).toHaveLength(0);
  });

  it("reads the attachment bytes out of storage", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");
    await seedApprovalWithAttachments(companyId, [{ contentType: "image/png", filename: "shot.png" }]);

    await createTelegramChannel(db, { transport, storage }).deliver({ companyId }, approvalPayload());

    expect(photos[0]!.file.bytes.toString()).toBe("bytes-for-key-shot.png");
  });

  it("skips an attachment too large for Telegram to accept", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");
    await seedApprovalWithAttachments(companyId, [
      { contentType: "image/png", filename: "huge.png", byteSize: 99_000_000 },
    ]);

    await createTelegramChannel(db, { transport, storage }).deliver({ companyId }, approvalPayload());

    expect(photos).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  it("falls back to a plain card when no storage is wired in", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");
    await seedApprovalWithAttachments(companyId, [{ contentType: "image/png", filename: "shot.png" }]);

    await createTelegramChannel(db, { transport }).deliver({ companyId }, approvalPayload());

    expect(photos).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  it("names the linked issues on the card", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");
    await seedApprovalWithAttachments(companyId, []);

    await createTelegramChannel(db, { transport, storage }).deliver({ companyId }, approvalPayload());

    expect(sent[0]!.text).toContain("PAP-14");
  });

  it("still delivers when the approval row cannot be read", async () => {
    const companyId = await seedCompany();
    await seedBot(companyId);
    await seedBinding(companyId, "111", "user-1");

    await createTelegramChannel(db, { transport, storage }).deliver({ companyId }, approvalPayload());

    expect(sent).toHaveLength(1);
  });
});
// [END: module]

