import { describe, it, expect } from "vitest";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "./push.js";

describe("push validators", () => {
  const sub = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" }, userAgent: "UA" };
  it("accepts a valid subscription", () => {
    expect(pushSubscriptionSchema.parse(sub).endpoint).toBe(sub.endpoint);
  });
  it("rejects a missing endpoint", () => {
    expect(() => pushSubscriptionSchema.parse({ ...sub, endpoint: "" })).toThrow();
  });
  it("rejects missing keys", () => {
    expect(() => pushSubscriptionSchema.parse({ endpoint: sub.endpoint })).toThrow();
  });
  it("accepts an unsubscribe by endpoint", () => {
    expect(pushUnsubscribeSchema.parse({ endpoint: sub.endpoint }).endpoint).toBe(sub.endpoint);
  });
});

import { pushPrefsSchema } from "./push.js";

describe("pushPrefsSchema", () => {
  const base = { minBand: "high", quietStart: null, quietEnd: null, timezone: null };
  it("accepts a minimal prefs object", () => {
    expect(pushPrefsSchema.parse(base).minBand).toBe("high");
  });
  it("accepts a full quiet window with tz", () => {
    expect(pushPrefsSchema.parse({ minBand: "critical", quietStart: "22:00", quietEnd: "08:00", timezone: "America/New_York" }).quietStart).toBe("22:00");
  });
  it("rejects a below-floor min band", () => {
    expect(() => pushPrefsSchema.parse({ ...base, minBand: "medium" })).toThrow();
  });
  it("rejects a half-set quiet window", () => {
    expect(() => pushPrefsSchema.parse({ ...base, quietStart: "22:00", quietEnd: null, timezone: "America/New_York" })).toThrow();
  });
  it("rejects quiet hours without a timezone", () => {
    expect(() => pushPrefsSchema.parse({ minBand: "high", quietStart: "22:00", quietEnd: "08:00", timezone: null })).toThrow();
  });
  it("rejects a malformed HH:MM", () => {
    expect(() => pushPrefsSchema.parse({ minBand: "high", quietStart: "9:00", quietEnd: "08:00", timezone: "UTC" })).toThrow();
  });
});

import { pushDeviceRenameSchema } from "./push.js";

describe("push device schemas", () => {
  it("subscription schema accepts an optional label", () => {
    expect(pushSubscriptionSchema.parse({ endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" }, label: "My phone" }).label).toBe("My phone");
  });
  it("rename schema requires a non-empty label", () => {
    expect(pushDeviceRenameSchema.parse({ label: "Laptop" }).label).toBe("Laptop");
    expect(() => pushDeviceRenameSchema.parse({ label: "" })).toThrow();
  });
});
