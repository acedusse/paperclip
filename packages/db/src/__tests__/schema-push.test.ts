import { describe, it, expect } from "vitest";
import { pushSubscriptions, pushVapidKeys } from "../schema/index.js";

describe("push schema", () => {
  it("exposes push_subscriptions and push_vapid_keys tables", () => {
    expect(pushSubscriptions).toBeDefined();
    expect(pushVapidKeys).toBeDefined();
  });

  it("exposes push_delivery_prefs and a label column on push_subscriptions", async () => {
    const { pushDeliveryPrefs } = await import("../schema/index.js");
    expect(pushDeliveryPrefs).toBeDefined();
    expect(pushSubscriptions.label).toBeDefined();
  });
});
