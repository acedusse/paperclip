/**
 * FILE: server/src/services/telegram-transport.test.ts
 * ABOUT: telegram-transport.test.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - unit tests for the fetch-backed Telegram Bot API transport.
 */
// ==========================================
// [META: module]
// INTENT: Pin the exact HTTP calls made to api.telegram.org against the documented Bot API: the
//   /bot<token>/METHOD URL form, the {ok, description} envelope (which returns 200 even on failure),
//   and the multipart shape for photo/document/media-group uploads.
// PSEUDOCODE: 1. Stub global fetch. 2. Call each method. 3. Assert URL, body and error handling.
// JSON_FLOW: {"file": "server/src/services/telegram-transport.test.ts", "imports": "vitest, ./telegram-transport.js", "exports": "none"}
// ==========================================
// [START: module]
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchTelegramTransport } from "./telegram-transport.js";

const BOT_TOKEN = "123456789:AAtoken";

describe("createFetchTelegramTransport", () => {
  let calls: { url: string; init: RequestInit }[];

  function respond(body: unknown, status = 200) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response);
  }

  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        calls.push({ url, init });
        return respond({ ok: true, result: {} });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonBody(index = 0): Record<string, unknown> {
    return JSON.parse(String(calls[index]!.init.body));
  }

  function formBody(index = 0): FormData {
    return calls[index]!.init.body as FormData;
  }

  describe("sendMessage", () => {
    it("posts to the documented /bot<token>/METHOD url", async () => {
      await createFetchTelegramTransport().sendMessage({ botToken: BOT_TOKEN, chatId: "5", text: "hi" });
      expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    });

    it("sends chat_id and text", async () => {
      await createFetchTelegramTransport().sendMessage({ botToken: BOT_TOKEN, chatId: "5", text: "hi" });
      expect(jsonBody()).toMatchObject({ chat_id: "5", text: "hi" });
    });

    it("passes parse_mode through when the caller asked for HTML", async () => {
      await createFetchTelegramTransport().sendMessage({
        botToken: BOT_TOKEN,
        chatId: "5",
        text: "<b>hi</b>",
        parseMode: "HTML",
      });
      expect(jsonBody().parse_mode).toBe("HTML");
    });

    it("omits parse_mode entirely when not requested", async () => {
      await createFetchTelegramTransport().sendMessage({ botToken: BOT_TOKEN, chatId: "5", text: "hi" });
      expect(jsonBody()).not.toHaveProperty("parse_mode");
    });

    it("disables the link preview through link_preview_options", async () => {
      await createFetchTelegramTransport().sendMessage({
        botToken: BOT_TOKEN,
        chatId: "5",
        text: "hi",
        linkPreviewDisabled: true,
      });
      expect(jsonBody().link_preview_options).toEqual({ is_disabled: true });
    });

    it("throws when Telegram answers 200 with ok:false", async () => {
      vi.stubGlobal("fetch", vi.fn(() => respond({ ok: false, description: "chat not found" })));
      await expect(
        createFetchTelegramTransport().sendMessage({ botToken: BOT_TOKEN, chatId: "5", text: "hi" }),
      ).rejects.toThrow(/chat not found/);
    });

    it("throws on a non-2xx response", async () => {
      vi.stubGlobal("fetch", vi.fn(() => respond({ ok: false, description: "Unauthorized" }, 401)));
      await expect(
        createFetchTelegramTransport().sendMessage({ botToken: BOT_TOKEN, chatId: "5", text: "hi" }),
      ).rejects.toThrow(/401/);
    });
  });

  describe("answerCallbackQuery", () => {
    it("sends the callback id and text", async () => {
      await createFetchTelegramTransport().answerCallbackQuery({
        botToken: BOT_TOKEN,
        callbackQueryId: "cb-1",
        text: "Approved",
      });
      expect(jsonBody()).toMatchObject({ callback_query_id: "cb-1", text: "Approved" });
    });

    it("clips the toast to the documented answer-text budget", async () => {
      await createFetchTelegramTransport().answerCallbackQuery({
        botToken: BOT_TOKEN,
        callbackQueryId: "cb-1",
        text: "z".repeat(500),
      });
      expect(String(jsonBody().text).length).toBeLessThanOrEqual(200);
    });
  });

  describe("editMessageReplyMarkup", () => {
    it("clears the keyboard for the given chat and message", async () => {
      await createFetchTelegramTransport().editMessageReplyMarkup({
        botToken: BOT_TOKEN,
        chatId: "5",
        messageId: 42,
      });
      expect(calls[0]!.url).toContain("/editMessageReplyMarkup");
      expect(jsonBody()).toMatchObject({ chat_id: "5", message_id: 42, reply_markup: { inline_keyboard: [] } });
    });
  });

  describe("sendPhoto", () => {
    const photo = { filename: "chart.png", contentType: "image/png", bytes: Buffer.from("PNGDATA") };

    it("uploads the bytes as multipart form-data", async () => {
      await createFetchTelegramTransport().sendPhoto({ botToken: BOT_TOKEN, chatId: "5", file: photo });
      expect(calls[0]!.url).toContain("/sendPhoto");
      const form = formBody();
      expect(form.get("chat_id")).toBe("5");
      expect(form.get("photo")).toBeInstanceOf(Blob);
    });

    it("carries the caption and its parse mode", async () => {
      await createFetchTelegramTransport().sendPhoto({
        botToken: BOT_TOKEN,
        chatId: "5",
        file: photo,
        caption: "<b>chart</b>",
        parseMode: "HTML",
      });
      expect(formBody().get("caption")).toBe("<b>chart</b>");
      expect(formBody().get("parse_mode")).toBe("HTML");
    });

    it("serialises the inline controls as JSON", async () => {
      await createFetchTelegramTransport().sendPhoto({
        botToken: BOT_TOKEN,
        chatId: "5",
        file: photo,
        replyMarkup: { inline_keyboard: [[{ text: "ok", callback_data: "x" }]] },
      });
      expect(JSON.parse(String(formBody().get("reply_markup")))).toEqual({
        inline_keyboard: [[{ text: "ok", callback_data: "x" }]],
      });
    });
  });

  describe("sendDocument", () => {
    it("uploads under the document field", async () => {
      await createFetchTelegramTransport().sendDocument({
        botToken: BOT_TOKEN,
        chatId: "5",
        file: { filename: "diagram.svg", contentType: "image/svg+xml", bytes: Buffer.from("<svg/>") },
      });
      expect(calls[0]!.url).toContain("/sendDocument");
      expect(formBody().get("document")).toBeInstanceOf(Blob);
    });
  });

  describe("sendMediaGroup", () => {
    it("references each upload through an attach:// name in the media array", async () => {
      await createFetchTelegramTransport().sendMediaGroup({
        botToken: BOT_TOKEN,
        chatId: "5",
        files: [
          { filename: "a.png", contentType: "image/png", bytes: Buffer.from("A") },
          { filename: "b.png", contentType: "image/png", bytes: Buffer.from("B") },
        ],
      });
      const form = formBody();
      const media = JSON.parse(String(form.get("media"))) as { type: string; media: string }[];
      expect(media).toHaveLength(2);
      expect(media[0]!.type).toBe("photo");
      expect(media[0]!.media).toMatch(/^attach:\/\//);
      expect(form.get(media[0]!.media.replace("attach://", ""))).toBeInstanceOf(Blob);
    });
  });
});
// [END: module]
