/**
 * FILE: ui/src/lib/push.test.ts
 * ABOUT: push.test.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - push.test.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: push.test.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/push.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushApi } from "../api/push";
import { pushSupported, subscribeToPush, unsubscribeFromPush } from "./push";

vi.mock("../api/push", () => ({
  pushApi: {
    vapidPublicKey: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  },
}));

describe("pushSupported", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when serviceWorker/Notification are unavailable", () => {
    vi.stubGlobal("navigator", {});
    delete (globalThis as { Notification?: unknown }).Notification;
    expect(pushSupported()).toBe(false);
  });

  it("returns true when serviceWorker and Notification are available", () => {
    vi.stubGlobal("navigator", { serviceWorker: {} });
    vi.stubGlobal("Notification", { requestPermission: vi.fn(), permission: "default" });
    expect(pushSupported()).toBe(true);
  });
});

describe("subscribeToPush", () => {
  beforeEach(() => {
    vi.mocked(pushApi.vapidPublicKey).mockResolvedValue({ publicKey: "QUJDRA" });
    vi.mocked(pushApi.subscribe).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("requests permission, subscribes via pushManager, and posts the subscription", async () => {
    const requestPermission = vi.fn(() => Promise.resolve("granted"));
    vi.stubGlobal("Notification", { requestPermission, permission: "default" });

    const subscribe = vi.fn(() =>
      Promise.resolve({
        endpoint: "https://p/x",
        toJSON: () => ({ keys: { p256dh: "p", auth: "a" } }),
      }),
    );
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve({ pushManager: { subscribe } }) },
      userAgent: "test-agent",
    });

    const result = await subscribeToPush("company-1");

    expect(result).toBe(true);
    expect(requestPermission).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      }),
    );
    expect(pushApi.subscribe).toHaveBeenCalledWith("company-1", {
      endpoint: "https://p/x",
      keys: { p256dh: "p", auth: "a" },
      userAgent: "test-agent",
    });
  });

  it("returns false and does not subscribe when permission is denied", async () => {
    const requestPermission = vi.fn(() => Promise.resolve("denied"));
    vi.stubGlobal("Notification", { requestPermission, permission: "default" });
    const subscribe = vi.fn();
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve({ pushManager: { subscribe } }) },
    });

    const result = await subscribeToPush("company-1");

    expect(result).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
    expect(pushApi.subscribe).not.toHaveBeenCalled();
  });
});

describe("unsubscribeFromPush", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("deletes the server row but does NOT call the browser sub.unsubscribe()", async () => {
    const unsubscribe = vi.fn(() => Promise.resolve(true));
    const sub = { endpoint: "https://push.example/e", unsubscribe };
    vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn() });
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(sub) } }) },
    });
    vi.mocked(pushApi.unsubscribe).mockResolvedValue({ ok: true });

    await unsubscribeFromPush("company-1");

    expect(pushApi.unsubscribe).toHaveBeenCalledWith("company-1", "https://push.example/e");
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("does nothing when there is no active subscription", async () => {
    const getSubscription = vi.fn(() => Promise.resolve(null));
    vi.stubGlobal("Notification", { requestPermission: vi.fn(), permission: "granted" });
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription } }) },
    });

    await unsubscribeFromPush("company-1");

    expect(pushApi.unsubscribe).not.toHaveBeenCalled();
  });
});
// [END: module]
