import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MINIAPP_INITDATA_MAX_AGE_SECONDS, verifyTelegramInitData } from "./telegram-initdata.js";

const BOT_TOKEN = "123456789:AAHk9Xy_ZqL0pQrStUvWxYz1234567890abc";
const NOW = new Date("2026-08-06T12:00:00.000Z");

/** Build a correctly-signed initData string, the way Telegram would. */
function signInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

function validFields(overrides: Record<string, string> = {}) {
  return {
    auth_date: String(Math.floor(NOW.getTime() / 1000)),
    query_id: "AAF_test",
    user: JSON.stringify({ id: 77, first_name: "Dana", username: "dana" }),
    ...overrides,
  };
}

describe("verifyTelegramInitData", () => {
  it("accepts a correctly signed payload and returns the Telegram user id as a string", () => {
    const result = verifyTelegramInitData({ initData: signInitData(validFields()), botToken: BOT_TOKEN, now: NOW });
    expect(result).toMatchObject({ ok: true, telegramUserId: "77" });
  });

  it("exposes the user's display fields", () => {
    const result = verifyTelegramInitData({ initData: signInitData(validFields()), botToken: BOT_TOKEN, now: NOW });
    if (!result.ok) throw new Error("expected ok");
    expect(result.user).toEqual({ id: "77", firstName: "Dana", username: "dana" });
  });

  // The failure mode of a broken HMAC check is silent acceptance, so this is the test that matters.
  it("rejects a payload whose fields were tampered with after signing", () => {
    const signed = signInitData(validFields());
    const params = new URLSearchParams(signed);
    params.set("user", JSON.stringify({ id: 999, first_name: "Mallory" }));
    const result = verifyTelegramInitData({ initData: params.toString(), botToken: BOT_TOKEN, now: NOW });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a payload signed with a different bot token", () => {
    const signed = signInitData(validFields(), "999:OTHERTOKEN");
    const result = verifyTelegramInitData({ initData: signed, botToken: BOT_TOKEN, now: NOW });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a payload with no hash at all", () => {
    const params = new URLSearchParams(validFields());
    const result = verifyTelegramInitData({ initData: params.toString(), botToken: BOT_TOKEN, now: NOW });
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a stale payload, since a signature does not expire on its own", () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - MINIAPP_INITDATA_MAX_AGE_SECONDS - 1);
    const result = verifyTelegramInitData({
      initData: signInitData(validFields({ auth_date: old })),
      botToken: BOT_TOKEN,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts a payload right at the freshness boundary", () => {
    const edge = String(Math.floor(NOW.getTime() / 1000) - MINIAPP_INITDATA_MAX_AGE_SECONDS);
    const result = verifyTelegramInitData({
      initData: signInitData(validFields({ auth_date: edge })),
      botToken: BOT_TOKEN,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a correctly signed payload that names no user", () => {
    const fields = validFields();
    delete (fields as Record<string, string>).user;
    const result = verifyTelegramInitData({ initData: signInitData(fields), botToken: BOT_TOKEN, now: NOW });
    expect(result).toEqual({ ok: false, reason: "no_user" });
  });

  it("rejects a non-numeric auth_date", () => {
    const result = verifyTelegramInitData({
      initData: signInitData(validFields({ auth_date: "not-a-date" })),
      botToken: BOT_TOKEN,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });
});
