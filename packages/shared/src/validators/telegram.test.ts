import { describe, expect, it } from "vitest";
import { telegramConfigSchema, telegramLinkCodeSchema } from "./telegram.js";

const BOT_TOKEN = "123456789:AAHk9Xy_ZqL0pQrStUvWxYz1234567890abc";

describe("telegramConfigSchema", () => {
  it("accepts a bot token on its own", () => {
    expect(telegramConfigSchema.parse({ botToken: BOT_TOKEN }).botToken).toBe(BOT_TOKEN);
  });

  it("rejects an empty bot token", () => {
    expect(() => telegramConfigSchema.parse({ botToken: "" })).toThrow();
  });

  it("rejects a public base URL that is not a URL", () => {
    expect(() => telegramConfigSchema.parse({ botToken: BOT_TOKEN, publicBaseUrl: "ops.example.com" })).toThrow();
  });

  it("accepts a null public base URL", () => {
    expect(telegramConfigSchema.parse({ botToken: BOT_TOKEN, publicBaseUrl: null }).publicBaseUrl).toBeNull();
  });

  it("defaults to enabled", () => {
    expect(telegramConfigSchema.parse({ botToken: BOT_TOKEN }).enabled).toBe(true);
  });
});

describe("telegramLinkCodeSchema", () => {
  it("accepts an empty body", () => {
    expect(telegramLinkCodeSchema.parse({})).toBeTruthy();
  });

  it("rejects a ttl outside the allowed window", () => {
    expect(() => telegramLinkCodeSchema.parse({ ttlMinutes: 0 })).toThrow();
    expect(() => telegramLinkCodeSchema.parse({ ttlMinutes: 10_000 })).toThrow();
  });
});
