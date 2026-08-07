/**
 * FILE: server/src/routes/telegram.ts
 * ABOUT: telegram.ts (routes module).
 *
 * SECTIONS:
 *   [TAG: module] - board setup routes for the Telegram channel plus the untrusted inbound webhook.
 */
// ==========================================
// [META: module]
// INTENT: Let a board register a bot and link operator chats, and accept Telegram's webhook deliveries —
//   which are unauthenticated by Paperclip's actor middleware and therefore trusted only as far as the
//   per-company secret token proves, with every governed action re-derived from the chat's binding.
// PSEUDOCODE: 1. Board routes: GET/PUT/DELETE config (token write-only), POST link-codes, GET/DELETE
//   bindings. 2. POST /telegram/webhook/:companyId — constant-time secret check, then dispatch a
//   callback_query to the decision service or a "/start <code>" message to the link service.
//   3. Always answer 200 after authentication so Telegram does not retry a delivery we understood.
// JSON_FLOW: {"file": "server/src/routes/telegram.ts", "imports": "express, drizzle-orm, @paperclipai/db, @paperclipai/shared, ../services/*", "exports": "telegramRoutes"}
// ==========================================
// [START: module]
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { companies, telegramBotConfigs, type Db } from "@paperclipai/db";
import { telegramConfigSchema, telegramLinkCodeSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { logger } from "../middleware/logger.js";
import { constantTimeStringEqual } from "../middleware/auth.js";
import {
  buildDecisionAck,
  buildLinkedMessage,
  createFetchTelegramTransport,
  decodeApprovalCallback,
  telegramDecisionService,
  telegramLinkService,
  telegramMiniappSessionService,
  type TelegramTransport,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";

const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";
const WEBHOOK_SECRET_BYTES = 24;

/** Minimal shape of the Telegram Update fields this channel reads. Everything else is ignored. */
type TelegramUpdate = {
  callback_query?: {
    id?: string;
    data?: string;
    /** The account that pressed the button — the only thing that proves *who* acted. */
    from?: { id?: number | string };
    message?: { message_id?: number; chat?: { id?: number | string } };
  };
  message?: { chat?: { id?: number | string }; from?: { id?: number | string }; text?: string };
};

/** Telegram ids arrive as numbers; we store and compare them as strings. */
function idOf(entity: { id?: number | string } | undefined): string | null {
  if (entity?.id === undefined || entity.id === null) return null;
  return String(entity.id);
}

/**
 * Split a message into its command and argument. A bare `startsWith("/start")` test does not survive
 * real traffic: clients append `@botname` to commands sent in a group — the exact place a shared ops
 * chat gets linked — and `/startle` would match the prefix while being a different command.
 */
export function parseTelegramCommand(text: string | undefined): { command: string; arg: string } | null {
  const trimmed = text?.trim();
  if (!trimmed?.startsWith("/")) return null;
  const boundary = trimmed.search(/\s/);
  const head = boundary === -1 ? trimmed : trimmed.slice(0, boundary);
  const arg = boundary === -1 ? "" : trimmed.slice(boundary + 1).trim();
  // `/start@yourbot` and `/START` are both the start command.
  return { command: head.split("@")[0]!.toLowerCase(), arg };
}

export function telegramRoutes(
  db: Db,
  options: { transport?: TelegramTransport; pluginWorkerManager?: PluginWorkerManager } = {},
) {
  const router = Router();
  const transport = options.transport ?? createFetchTelegramTransport();
  const links = telegramLinkService(db);
  const decisions = telegramDecisionService(db, { pluginWorkerManager: options.pluginWorkerManager });
  const miniappSessions = telegramMiniappSessionService(db);

  async function loadConfig(companyId: string) {
    const [row] = await db.select().from(telegramBotConfigs).where(eq(telegramBotConfigs.companyId, companyId));
    return row ?? null;
  }

  // ---- board setup surface -------------------------------------------------

  router.get("/companies/:companyId/telegram/config", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const config = await loadConfig(companyId);
    if (!config) {
      res.json({ configured: false });
      return;
    }
    // The bot token is write-only: it is never echoed back on any read path.
    res.json({
      configured: true,
      botUsername: config.botUsername,
      enabled: config.enabled,
      publicBaseUrl: config.publicBaseUrl,
      webhookPath: `/api/telegram/webhook/${companyId}`,
      updatedAt: config.updatedAt,
    });
  });

  router.put("/companies/:companyId/telegram/config", validate(telegramConfigSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const { botToken, botUsername, publicBaseUrl, enabled } = req.body;
    const existing = await loadConfig(companyId);
    // Keep the secret stable across edits so an already-registered webhook URL keeps working.
    const webhookSecret = existing?.webhookSecret ?? randomBytes(WEBHOOK_SECRET_BYTES).toString("base64url");
    await db
      .insert(telegramBotConfigs)
      .values({
        companyId,
        botToken,
        botUsername: botUsername ?? null,
        publicBaseUrl: publicBaseUrl ?? null,
        enabled,
        webhookSecret,
      })
      .onConflictDoUpdate({
        target: telegramBotConfigs.companyId,
        set: {
          botToken,
          botUsername: botUsername ?? null,
          publicBaseUrl: publicBaseUrl ?? null,
          enabled,
          updatedAt: new Date(),
        },
      });
    // Give the chat a persistent way into the board. Best-effort: the registration is saved either
    // way, and a transport failure here must not look like a failed save.
    if (publicBaseUrl) {
      await transport
        .setChatMenuButton({
          botToken,
          text: "Open Paperclip",
          url: `${publicBaseUrl.replace(/\/$/, "")}/telegram/app?c=${companyId}`,
        })
        .catch((err) => logger.warn({ err, companyId }, "failed to set telegram chat menu button"));
    }
    res.json({
      ok: true,
      webhookPath: `/api/telegram/webhook/${companyId}`,
      webhookSecret,
    });
  });

  router.delete("/companies/:companyId/telegram/config", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    // Removing the bot must also end every chat's authority to act for this company -- including the
    // Mini App sessions those chats minted, which outlive the buttons by up to the session TTL unless
    // they are revoked here too. links.revokeAllBindings does both halves; running it in the same
    // transaction as the config delete means there is no window where the bot is gone but a webview
    // still holds a working board session.
    await db.transaction(async (tx) => {
      await tx.delete(telegramBotConfigs).where(eq(telegramBotConfigs.companyId, companyId));
      await links.revokeAllBindings({ companyId }, tx);
    });
    res.json({ ok: true });
  });

  router.post(
    "/companies/:companyId/telegram/link-codes",
    validate(telegramLinkCodeSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      const config = await loadConfig(companyId);
      if (!config) {
        res.status(409).json({ error: "Configure a Telegram bot for this company first" });
        return;
      }
      const actor = getActorInfo(req);
      const issued = await links.createLinkCode({
        companyId,
        userId: actor.actorId,
        chatLabel: req.body.chatLabel ?? null,
        ttlMinutes: req.body.ttlMinutes,
      });
      res.status(201).json({
        code: issued.code,
        expiresAt: issued.expiresAt,
        deepLink: config.botUsername ? `https://t.me/${config.botUsername}?start=${issued.code}` : null,
      });
    },
  );

  router.get("/companies/:companyId/telegram/bindings", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const rows = await links.listBindings(companyId);
    res.json(
      rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        chatLabel: r.chatLabel,
        linkedAt: r.linkedAt,
        lastUsedAt: r.lastUsedAt,
      })),
    );
  });

  router.delete("/companies/:companyId/telegram/bindings/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const revoked = await links.revokeBinding({ companyId, id: req.params.id as string });
    if (!revoked) {
      res.status(404).json({ error: "Binding not found" });
      return;
    }
    res.json({ ok: true });
  });

  // ---- mini app session (untrusted; the signature is the whole gate) ---------

  router.post("/telegram/miniapp/session", async (req, res) => {
    const { companyId, initData } = (req.body ?? {}) as { companyId?: unknown; initData?: unknown };
    if (typeof companyId !== "string" || typeof initData !== "string") {
      res.status(400).json({ error: "companyId and initData are required" });
      return;
    }

    const result = await miniappSessions.mint({ companyId, initData });
    if (!result.ok) {
      if (result.reason === "no_bot") {
        res.status(404).json({ error: "No Telegram bot for this company" });
        return;
      }
      // Everything else is an authentication failure, and the reason is deliberately not echoed:
      // an unauthenticated caller learns nothing about which part of their payload was wrong.
      logger.warn({ companyId, reason: result.reason }, "telegram mini app session refused");
      res.status(401).json({ error: "Could not authenticate this Telegram session" });
      return;
    }

    res.json({
      token: result.token,
      expiresAt: result.expiresAt,
      userId: result.userId,
      companyId: result.companyId,
      user: result.user,
    });
  });

  // ---- inbound webhook (untrusted) ----------------------------------------

  router.post("/telegram/webhook/:companyId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const config = await loadConfig(companyId);
    if (!config) {
      res.status(404).json({ error: "No Telegram bot for this company" });
      return;
    }
    const presented = req.header(WEBHOOK_SECRET_HEADER) ?? "";
    if (!constantTimeStringEqual(presented, config.webhookSecret)) {
      res.status(401).json({ error: "Invalid webhook secret" });
      return;
    }
    if (!config.enabled) {
      res.json({ ok: true, ignored: "disabled" });
      return;
    }

    const update = req.body as TelegramUpdate;

    try {
      if (update.callback_query) {
        const chatId = idOf(update.callback_query.message?.chat);
        const fromTelegramUserId = idOf(update.callback_query.from);
        const decoded = decodeApprovalCallback(update.callback_query.data);
        const callbackQueryId = update.callback_query.id ?? "";
        if (!chatId || !decoded) {
          if (callbackQueryId) {
            await transport.answerCallbackQuery({
              botToken: config.botToken,
              callbackQueryId,
              text: "Unrecognised action",
            });
          }
          res.json({ ok: true });
          return;
        }

        const result = await decisions.decideFromChat({
          companyId,
          chatId,
          fromTelegramUserId,
          approvalId: decoded.approvalId,
          outcome: decoded.outcome,
        });

        let ack: string;
        if (result.ok) {
          ack = buildDecisionAck({ outcome: result.outcome, applied: result.applied });
        } else if (result.reason === "not_bound") {
          ack = "This chat is not linked to a Paperclip user";
        } else if (result.reason === "not_the_bound_user") {
          ack = "Only the person who linked this chat can decide here";
        } else if (result.reason === "binding_predates_user_identity") {
          ack = "This link is out of date — re-link the chat from the Paperclip board to decide here";
        } else if (result.reason === "not_found") {
          ack = "Approval not found";
        } else if (result.reason === "already_decided") {
          ack = `Already ${result.status}`;
        } else {
          ack = buildDecisionAck({ outcome: decoded.outcome, applied: false, detail: result.detail });
        }

        if (callbackQueryId) {
          await transport.answerCallbackQuery({ botToken: config.botToken, callbackQueryId, text: ack });
        }
        // Retire the buttons whenever the approval is settled — including when it was settled in the
        // UI — so a stale message cannot be tapped again and again.
        const settled = result.ok || result.reason === "already_decided";
        const messageId = update.callback_query.message?.message_id;
        if (settled && messageId !== undefined) {
          await transport
            .editMessageReplyMarkup({ botToken: config.botToken, chatId, messageId })
            .catch((err) => logger.warn({ err, companyId }, "failed to retire telegram approval buttons"));
        }
        res.json({ ok: true });
        return;
      }

      const parsed = parseTelegramCommand(update.message?.text);
      const chatId = idOf(update.message?.chat);
      const senderId = idOf(update.message?.from);
      if (parsed?.command === "/start" && chatId) {
        const code = parsed.arg;
        // Without a sender there is no identity to bind to — channel posts carry no `from`. Refuse
        // rather than create a binding that could never satisfy the callback check.
        const redeemed =
          code && senderId
            ? await links.redeemLinkCode({ code, chatId, telegramUserId: senderId })
            : ({ ok: false, reason: "unknown_code" } as const);
        if (redeemed.ok) {
          const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
          const welcome = buildLinkedMessage({ companyName: company?.name ?? "this company" });
          await transport.sendMessage({
            botToken: config.botToken,
            chatId,
            text: welcome.text,
            parseMode: welcome.parseMode,
          });
        } else {
          await transport.sendMessage({
            botToken: config.botToken,
            chatId,
            text:
              redeemed.reason === "expired"
                ? "⏳ That link code has expired. Ask for a fresh one from the Paperclip board."
                : "🚫 That link code is not valid. Ask for a fresh one from the Paperclip board.",
          });
        }
        res.json({ ok: true });
        return;
      }
    } catch (err) {
      // Telegram retries on a non-2xx, which would replay the same tap. Log and swallow instead.
      logger.warn({ err, companyId }, "telegram webhook handling failed");
    }

    res.json({ ok: true });
  });

  return router;
}
// [END: module]
