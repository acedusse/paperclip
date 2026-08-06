/**
 * FILE: server/src/services/telegram-transport.ts
 * ABOUT: telegram-transport.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - the Telegram Bot API calls this channel makes, behind one injectable interface.
 */
// ==========================================
// [META: module]
// INTENT: Isolate every outbound HTTP call to api.telegram.org behind a small interface so the channel,
//   the webhook and their tests all run against the same contract without touching the network.
//   Shapes verified against core.telegram.org/bots/api: base url https://api.telegram.org/bot<token>/METHOD,
//   the {ok, description} envelope (200 is returned even for logical failures), callback answer text
//   capped at 200, and file uploads as multipart/form-data with attach:// refs for media groups.
// PSEUDOCODE: 1. callBotApi posts JSON and throws unless HTTP-ok AND envelope-ok.
//   2. callBotApiMultipart does the same with FormData for uploads.
//   3. Each method maps camelCase input onto the documented snake_case fields.
// JSON_FLOW: {"file": "server/src/services/telegram-transport.ts", "imports": "./telegram-format.js", "exports": "TelegramTransport, TelegramSendMessage, TelegramUploadFile, createFetchTelegramTransport"}
// ==========================================
// [START: module]
import { TELEGRAM_CALLBACK_ANSWER_LIMIT, truncateForTelegram, type TelegramInlineButton } from "./telegram-format.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 10_000;
/** sendMediaGroup accepts "2-10 items". */
export const TELEGRAM_MEDIA_GROUP_MAX = 10;

export type TelegramReplyMarkup = { inline_keyboard: TelegramInlineButton[][] };

export type TelegramUploadFile = {
  filename: string;
  contentType: string;
  bytes: Buffer;
};

export type TelegramSendMessage = {
  botToken: string;
  chatId: string;
  text: string;
  parseMode?: "HTML";
  linkPreviewDisabled?: boolean;
  replyMarkup?: TelegramReplyMarkup;
};

export type TelegramSendMedia = {
  botToken: string;
  chatId: string;
  file: TelegramUploadFile;
  caption?: string;
  parseMode?: "HTML";
  replyMarkup?: TelegramReplyMarkup;
};

export type TelegramTransport = {
  sendMessage(input: TelegramSendMessage): Promise<void>;
  /** The toast on the tapping device; required or the button spins forever. */
  answerCallbackQuery(input: { botToken: string; callbackQueryId: string; text: string }): Promise<void>;
  /** Strip the controls off a settled approval so the same message cannot be tapped twice. */
  editMessageReplyMarkup(input: { botToken: string; chatId: string; messageId: number }): Promise<void>;
  sendPhoto(input: TelegramSendMedia): Promise<void>;
  sendDocument(input: TelegramSendMedia): Promise<void>;
  /** Album of 2-10 photos. Note: the Bot API accepts no reply_markup here — send controls separately. */
  sendMediaGroup(input: { botToken: string; chatId: string; files: TelegramUploadFile[] }): Promise<void>;
  /** Put a persistent "open the board" button on the bot's chat. Best-effort; never blocks a save. */
  setChatMenuButton(input: { botToken: string; text: string; url: string }): Promise<void>;
};

function methodUrl(botToken: string, method: string): string {
  return `${TELEGRAM_API_BASE}/bot${botToken}/${method}`;
}

async function assertOk(res: Response, method: string): Promise<void> {
  // Telegram answers 200 with {ok:false} for logical failures, so status alone is not enough.
  const parsed = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!res.ok || !parsed?.ok) {
    throw new Error(`telegram ${method} failed: ${res.status} ${parsed?.description ?? "unknown error"}`);
  }
}

async function callBotApi(botToken: string, method: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(methodUrl(botToken, method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await assertOk(res, method);
}

async function callBotApiMultipart(botToken: string, method: string, form: FormData): Promise<void> {
  // No explicit content-type: fetch sets multipart/form-data with the boundary itself.
  const res = await fetch(methodUrl(botToken, method), {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await assertOk(res, method);
}

function fileBlob(file: TelegramUploadFile): Blob {
  return new Blob([new Uint8Array(file.bytes)], { type: file.contentType });
}

function appendMediaFields(form: FormData, input: TelegramSendMedia): void {
  form.set("chat_id", input.chatId);
  if (input.caption) form.set("caption", input.caption);
  if (input.parseMode) form.set("parse_mode", input.parseMode);
  if (input.replyMarkup) form.set("reply_markup", JSON.stringify(input.replyMarkup));
}

export function createFetchTelegramTransport(): TelegramTransport {
  return {
    async sendMessage(input) {
      await callBotApi(input.botToken, "sendMessage", {
        chat_id: input.chatId,
        text: input.text,
        ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
        ...(input.linkPreviewDisabled ? { link_preview_options: { is_disabled: true } } : {}),
        ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
      });
    },

    async answerCallbackQuery(input) {
      await callBotApi(input.botToken, "answerCallbackQuery", {
        callback_query_id: input.callbackQueryId,
        text: truncateForTelegram(input.text, TELEGRAM_CALLBACK_ANSWER_LIMIT),
      });
    },

    async editMessageReplyMarkup(input) {
      await callBotApi(input.botToken, "editMessageReplyMarkup", {
        chat_id: input.chatId,
        message_id: input.messageId,
        reply_markup: { inline_keyboard: [] },
      });
    },

    async sendPhoto(input) {
      const form = new FormData();
      appendMediaFields(form, input);
      form.set("photo", fileBlob(input.file), input.file.filename);
      await callBotApiMultipart(input.botToken, "sendPhoto", form);
    },

    async sendDocument(input) {
      const form = new FormData();
      appendMediaFields(form, input);
      form.set("document", fileBlob(input.file), input.file.filename);
      await callBotApiMultipart(input.botToken, "sendDocument", form);
    },

    async sendMediaGroup(input) {
      const form = new FormData();
      form.set("chat_id", input.chatId);
      const media = input.files.slice(0, TELEGRAM_MEDIA_GROUP_MAX).map((file, index) => {
        // Each uploaded part is referenced from the media array by its form field name.
        const partName = `file${index}`;
        form.set(partName, fileBlob(file), file.filename);
        return { type: "photo", media: `attach://${partName}` };
      });
      form.set("media", JSON.stringify(media));
      await callBotApiMultipart(input.botToken, "sendMediaGroup", form);
    },

    async setChatMenuButton(input) {
      await callBotApi(input.botToken, "setChatMenuButton", {
        menu_button: { type: "web_app", text: input.text, web_app: { url: input.url } },
      });
    },
  };
}
// [END: module]
