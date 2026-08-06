/**
 * FILE: server/src/services/telegram-channel.ts
 * ABOUT: telegram-channel.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - the outbound "telegram" notification delivery channel.
 */
// ==========================================
// [META: module]
// INTENT: Deliver notifications to the chats a company's operators have bound, with the same risk-band
//   and quiet-hours floor web push uses. An approval arrives as an HTML card with inline controls,
//   carrying its own screenshots and diagrams so the operator can judge it without a laptop; anything
//   else (SLA breach, budget incident) arrives as a plain card with a link back to the board.
// PSEUDOCODE: 1. Skip payloads with no push block. 2. Load the company's enabled bot config.
//   3. Load live bindings, narrowed to target.userId when the notification names one, + delivery prefs.
//   4. For an approval, resolve linked issues and their image attachments once (best-effort; never
//   blocks the send). 5. Per eligible chat pick the richest shape the Bot API allows: photo+caption+
//   controls, album then controls, document+caption+controls, or text.
// JSON_FLOW: {"file": "server/src/services/telegram-channel.ts", "imports": "drizzle-orm, @paperclipai/db, ./telegram-*.js, ./push-prefs.js", "exports": "createTelegramChannel, loadTelegramBotConfig"}
// ==========================================
// [START: module]
import { and, eq, inArray } from "drizzle-orm";
import {
  assets,
  issueApprovals,
  issueAttachments,
  issues,
  pushDeliveryPrefs,
  telegramBotConfigs,
  type Db,
  type TelegramBotConfigRow,
} from "@paperclipai/db";
import type { DeliveryChannel } from "./notification-delivery.js";
import { buildAlertMessage, buildApprovalMessage } from "./telegram-format.js";
import { telegramLinkService } from "./telegram-link.js";
import {
  TELEGRAM_MEDIA_GROUP_MAX,
  createFetchTelegramTransport,
  type TelegramTransport,
  type TelegramUploadFile,
} from "./telegram-transport.js";
import { shouldPushToUser } from "./push-prefs.js";
import type { RiskBand } from "./approval-risk.js";
import type { StorageService } from "../storage/types.js";
import { logger } from "../middleware/logger.js";

/**
 * Telegram accepts photos up to 10 MB and documents up to 50 MB when the bot uploads them. Anything
 * larger stays in Paperclip and the operator follows the link instead of waiting on a doomed upload.
 */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
/** Content types Telegram renders inline as a photo. SVG is an image but is not one of them. */
const PHOTO_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

type ResolvedMedia = { photos: TelegramUploadFile[]; documents: TelegramUploadFile[] };

/** The company's bot registration, or null when Telegram is not set up (or is switched off) for it. */
export async function loadTelegramBotConfig(db: Db, companyId: string): Promise<TelegramBotConfigRow | null> {
  const [row] = await db
    .select()
    .from(telegramBotConfigs)
    .where(and(eq(telegramBotConfigs.companyId, companyId), eq(telegramBotConfigs.enabled, true)));
  return row ?? null;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function createTelegramChannel(
  db: Db,
  deps: { transport?: TelegramTransport; storage?: StorageService } = {},
): DeliveryChannel {
  const transport = deps.transport ?? createFetchTelegramTransport();
  const links = telegramLinkService(db);

  /** Issue identifiers linked to this approval — shown on the card so the operator has context. */
  async function linkedIssueIdentifiers(companyId: string, approvalId: string): Promise<{ ids: string[]; identifiers: string[] }> {
    const rows = await db
      .select({ id: issues.id, identifier: issues.identifier })
      .from(issueApprovals)
      .innerJoin(issues, eq(issues.id, issueApprovals.issueId))
      .where(and(eq(issueApprovals.approvalId, approvalId), eq(issueApprovals.companyId, companyId)));
    return {
      ids: rows.map((r) => r.id),
      identifiers: rows.map((r) => r.identifier).filter((v): v is string => Boolean(v)),
    };
  }

  /**
   * Pull the attachments hanging off the approval's linked issues and load their bytes. Best-effort by
   * design: a storage hiccup must degrade the message to text, never drop the approval.
   */
  async function resolveMedia(companyId: string, issueIds: string[]): Promise<ResolvedMedia> {
    const empty: ResolvedMedia = { photos: [], documents: [] };
    if (!deps.storage || issueIds.length === 0) return empty;

    const rows = await db
      .select({
        objectKey: assets.objectKey,
        contentType: assets.contentType,
        byteSize: assets.byteSize,
        originalFilename: assets.originalFilename,
      })
      .from(issueAttachments)
      .innerJoin(assets, eq(assets.id, issueAttachments.assetId))
      .where(and(eq(issueAttachments.companyId, companyId), inArray(issueAttachments.issueId, issueIds)));

    const media: ResolvedMedia = { photos: [], documents: [] };
    for (const row of rows) {
      if (!row.contentType.startsWith("image/")) continue;
      const asPhoto = PHOTO_CONTENT_TYPES.has(row.contentType);
      if (row.byteSize > (asPhoto ? MAX_PHOTO_BYTES : MAX_DOCUMENT_BYTES)) continue;
      if (media.photos.length + media.documents.length >= TELEGRAM_MEDIA_GROUP_MAX) break;
      try {
        const object = await deps.storage.getObject(companyId, row.objectKey);
        const file: TelegramUploadFile = {
          filename: row.originalFilename ?? row.objectKey,
          contentType: row.contentType,
          bytes: await readAll(object.stream),
        };
        if (asPhoto) media.photos.push(file);
        else media.documents.push(file);
      } catch (err) {
        logger.warn({ err, companyId, objectKey: row.objectKey }, "telegram could not read an attachment");
      }
    }
    return media;
  }

  return {
    name: "telegram",
    async deliver(target, payload) {
      // `push` is what carries a renderable headline; a digest-only payload has nothing to show here.
      if (!target.companyId || !payload.push) return;

      const config = await loadTelegramBotConfig(db, target.companyId);
      if (!config) return;

      const allBindings = await links.listBindings(target.companyId);
      // A target naming a user is addressed to that person — the coverage sweep escalates to one
      // named backup, not to the company. Broadcasting it to every bound chat would disclose one
      // operator's queue to all of them. With no userId the notification is company-wide by design.
      const bindings = target.userId ? allBindings.filter((b) => b.userId === target.userId) : allBindings;
      if (bindings.length === 0) return;

      const prefRows = await db
        .select()
        .from(pushDeliveryPrefs)
        .where(eq(pushDeliveryPrefs.companyId, target.companyId));
      const prefsByUser = new Map(
        prefRows.map((r) => [
          r.userId,
          { minBand: r.minBand as RiskBand, quietStart: r.quietStart, quietEnd: r.quietEnd, timezone: r.timezone },
        ]),
      );

      const approvalId = payload.push.approvalId;
      // An approval gets the full treatment: inline decision controls plus whatever evidence hangs off
      // its linked issues. Anything else — an SLA breach, a budget incident — has no decision to encode,
      // so it arrives as a plain card with a link. Refusing to send those at all was why the coverage
      // escalation, the alert most in need of a phone, could never reach Telegram.
      let media: ResolvedMedia = { photos: [], documents: [] };
      let card: (asCaption: boolean) => ReturnType<typeof buildApprovalMessage>;

      if (approvalId) {
        // Context and media are the same for every chat, so resolve them once per delivery.
        const linked = await linkedIssueIdentifiers(target.companyId, approvalId).catch((err) => {
          logger.warn({ err, companyId: target.companyId, approvalId }, "telegram could not read linked issues");
          return { ids: [] as string[], identifiers: [] as string[] };
        });
        media = await resolveMedia(target.companyId, linked.ids).catch((err) => {
          logger.warn({ err, companyId: target.companyId, approvalId }, "telegram media resolution failed");
          return { photos: [], documents: [] } as ResolvedMedia;
        });
        card = (asCaption: boolean) =>
          buildApprovalMessage({
            title: payload.push!.title,
            body: payload.push!.body,
            url: payload.push!.url,
            approvalId,
            band: payload.push!.band,
            baseUrl: config.publicBaseUrl,
            linkedIssues: linked.identifiers,
            asCaption,
          });
      } else {
        card = () =>
          buildAlertMessage({
            title: payload.push!.title,
            body: payload.push!.body,
            url: payload.push!.url,
            band: payload.push!.band,
            baseUrl: config.publicBaseUrl,
          });
      }

      const band = (payload.push.band as RiskBand | undefined) ?? "high";
      const now = new Date();

      for (const binding of bindings) {
        if (!binding.chatId) continue;
        if (!shouldPushToUser({ prefs: prefsByUser.get(binding.userId) ?? null, band, now })) continue;
        const chatId = binding.chatId;
        try {
          await sendToChat(config.botToken, chatId, media, card);
          await links.touchBinding(binding.id);
        } catch (err) {
          logger.warn(
            { err, companyId: target.companyId, bindingId: binding.id },
            "telegram send failed for one chat",
          );
        }
      }
    },
  };

  /** Pick the richest message shape the Bot API allows for what this approval actually carries. */
  async function sendToChat(
    botToken: string,
    chatId: string,
    media: ResolvedMedia,
    card: (asCaption: boolean) => ReturnType<typeof buildApprovalMessage>,
  ): Promise<void> {
    const caption = card(true);
    const message = card(false);

    if (media.photos.length === 1 && media.documents.length === 0) {
      await transport.sendPhoto({
        botToken,
        chatId,
        file: media.photos[0]!,
        caption: caption.text,
        parseMode: caption.parseMode,
        replyMarkup: caption.replyMarkup,
      });
      return;
    }

    if (media.photos.length >= 2) {
      // sendMediaGroup takes no reply_markup, so the album goes first and the controls follow it.
      await transport.sendMediaGroup({ botToken, chatId, files: media.photos });
      await transport.sendMessage({
        botToken,
        chatId,
        text: message.text,
        parseMode: message.parseMode,
        linkPreviewDisabled: message.linkPreviewDisabled,
        replyMarkup: message.replyMarkup,
      });
      return;
    }

    if (media.documents.length > 0) {
      await transport.sendDocument({
        botToken,
        chatId,
        file: media.documents[0]!,
        caption: caption.text,
        parseMode: caption.parseMode,
        replyMarkup: caption.replyMarkup,
      });
      for (const extra of media.documents.slice(1)) {
        await transport.sendDocument({ botToken, chatId, file: extra });
      }
      return;
    }

    await transport.sendMessage({
      botToken,
      chatId,
      text: message.text,
      parseMode: message.parseMode,
      linkPreviewDisabled: message.linkPreviewDisabled,
      replyMarkup: message.replyMarkup,
    });
  }
}
// [END: module]
