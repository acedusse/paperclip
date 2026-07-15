import { describe, it, expect } from "vitest";
import { pushSubscriptions, pushVapidKeys } from "../schema/index.js";

describe("push schema", () => {
  it("exposes push_subscriptions and push_vapid_keys tables", () => {
    expect(pushSubscriptions).toBeDefined();
    expect(pushVapidKeys).toBeDefined();
  });
});
