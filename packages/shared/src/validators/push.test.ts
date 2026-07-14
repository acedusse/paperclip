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
