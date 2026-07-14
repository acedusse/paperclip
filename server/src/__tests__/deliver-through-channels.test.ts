import { describe, it, expect, vi, afterEach } from "vitest";
import { registerChannel, getChannels, deliverThroughChannels } from "../services/notification-delivery.js";

function clearChannels() {
  // Register no-op replacements is awkward; instead assert behavior via spies on fresh fake channels.
}

describe("deliverThroughChannels", () => {
  it("invokes every registered channel and isolates a throwing one", async () => {
    const good = vi.fn(() => Promise.resolve());
    const bad = vi.fn(() => Promise.reject(new Error("boom")));
    registerChannel({ name: "inbox", deliver: good });
    registerChannel({ name: "webpush", deliver: bad });
    await expect(deliverThroughChannels({ companyId: "c1" }, { kind: "k", title: "t" })).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => {
  // reset the registry to avoid cross-test leakage within this file
  for (const c of getChannels()) registerChannel({ name: c.name, deliver: () => Promise.resolve() });
});
