import { describe, it, expect, vi, afterEach } from "vitest";
import { registerChannel, getChannels, deliverThroughChannels } from "../services/notification-delivery.js";

describe("deliverThroughChannels", () => {
  it("invokes every registered channel and isolates a throwing one", async () => {
    const inbox = vi.fn(() => Promise.resolve());
    const webpush = vi.fn(() => Promise.reject(new Error("boom")));
    const email = vi.fn(() => Promise.resolve());
    registerChannel({ name: "inbox", deliver: inbox });
    registerChannel({ name: "webpush", deliver: webpush });
    registerChannel({ name: "email", deliver: email });
    await expect(deliverThroughChannels({ companyId: "c1" }, { kind: "k", title: "t" })).resolves.toBeUndefined();
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(webpush).toHaveBeenCalledTimes(1);
    expect(email).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => {
  // reset the registry to avoid cross-test leakage within this file
  for (const c of getChannels()) registerChannel({ name: c.name, deliver: () => Promise.resolve() });
});
