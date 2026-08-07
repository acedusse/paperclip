/**
 * FILE: ui/src/api/client.test.tsx
 * ABOUT: client.test.tsx (api module).
 *
 * SECTIONS:
 *   [TAG: module] - coverage for the client.ts <-> Telegram bearer seam.
 */
// ==========================================
// [META: module]
// INTENT: Nothing previously verified that client.ts actually attaches the Telegram bearer to a
//   request, or what happens when a bearer-carrying request 401s mid-session (the token expired). This
//   exercises the real seam: a real bearer minted through the real useTelegramSession hook (only
//   ./webapp's getTelegramWebApp is mocked, to control Telegram presence/initData), then real
//   api.get() calls against a stubbed global fetch, asserting the actual Authorization header on the
//   actual outgoing request -- not a mocked stand-in for the header logic.
// PSEUDOCODE: 1. Mock ../telegram/webapp so Telegram presence/initData is controlled. 2. Mint a bearer
//   through the real hook against a stubbed fetch. 3. Swap the fetch stub and call api.get(), asserting
//   the Authorization header on the real request. 4. For the 401 cases, assert that a bearer-carrying
//   401 marks the session terminally expired, issues no re-mint POST and makes no second attempt, while
//   an ordinary-board 401 leaves the Telegram expiry state untouched.
// JSON_FLOW: {"file": "ui/src/api/client.test.tsx", "imports": "react-dom, react-dom/client, vitest, ../telegram/webapp, ../telegram/useTelegramSession, ./client", "exports": "none"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramWebApp } from "../telegram/webapp";

const getTelegramWebApp = vi.fn<() => TelegramWebApp | null>();
vi.mock("../telegram/webapp", () => ({
  getTelegramWebApp: () => getTelegramWebApp(),
}));

// Imported after the mock so both modules resolve the mocked ../telegram/webapp.
const {
  useTelegramSession,
  getTelegramBearer,
  clearTelegramBearer,
  isTelegramSessionExpired,
  resetTelegramSessionExpiry,
} = await import("../telegram/useTelegramSession");
const { api, ApiError } = await import("./client");

const fakeApp: TelegramWebApp = { initData: "query_id=fake&user=fake" };

function Probe() {
  useTelegramSession();
  return null;
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForAssertion(assertion: () => void, attempts = 50) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flush();
    }
  }
  throw lastError;
}

/**
 * Mints a real bearer via the real hook + mint endpoint (mocked fetch), the same path production code
 * takes, so tests exercise the actual client.ts <-> useTelegramSession seam rather than hand-set state.
 */
async function mintBearer(token: string, companyId = "company-1"): Promise<void> {
  getTelegramWebApp.mockReturnValue(fakeApp);
  window.history.pushState({}, "", `/board?c=${companyId}`);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ token }), { status: 200 })),
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  flushSync(() => root.render(<Probe />));
  await waitForAssertion(() => expect(getTelegramBearer()).toBe(token));
  flushSync(() => root.unmount());
  container.remove();
}

describe("client.ts Telegram bearer integration", () => {
  let originalSearch: string;

  beforeEach(() => {
    getTelegramWebApp.mockReset();
    originalSearch = window.location.search;
    clearTelegramBearer();
    resetTelegramSessionExpiry();
  });

  afterEach(() => {
    window.history.pushState({}, "", `${window.location.pathname}${originalSearch}`);
    clearTelegramBearer();
    vi.unstubAllGlobals();
  });

  it("attaches the bearer as an Authorization header once one is held", async () => {
    await mintBearer("tok_abc");
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", apiFetch);

    await api.get("/whoami");

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/whoami");
    expect((init.headers as Headers).get("authorization")).toBe("Bearer tok_abc");
  });

  it("sends no Authorization header outside Telegram, and the ordinary board is untouched", async () => {
    getTelegramWebApp.mockReturnValue(null);
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", apiFetch);

    await api.get("/whoami");

    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).has("authorization")).toBe(false);
    expect((init as { credentials?: string }).credentials).toBe("include");
  });

  // The webview cannot renew a session: Telegram's initData carries a fixed auth_date the server
  // rejects after five minutes, and there is no API to re-source it while the Mini App is open. So a
  // 401 on a bearer-carrying request must end the session honestly rather than retry into the same wall.
  it("on a 401, marks the session terminally expired and does not retry", async () => {
    await mintBearer("tok_old", "company-7");

    const apiFetch = vi.fn(async (url: string) => {
      void url;
      return new Response(JSON.stringify({ error: "expired" }), { status: 401 });
    });
    vi.stubGlobal("fetch", apiFetch);

    await expect(api.get("/whoami")).rejects.toBeInstanceOf(ApiError);
    await expect(api.get("/whoami")).rejects.toMatchObject({ status: 401 });

    expect(isTelegramSessionExpired()).toBe(true);
    expect(getTelegramBearer()).toBeNull();
    // No re-mint POST at all, and exactly one underlying request per api.get() call.
    expect(apiFetch.mock.calls.filter(([url]) => url === "/api/telegram/miniapp/session")).toHaveLength(0);
    expect(apiFetch.mock.calls.filter(([url]) => url === "/api/whoami")).toHaveLength(2);
  });

  it("does not mark a Telegram session expired on a 401 when no bearer was ever held (ordinary board)", async () => {
    getTelegramWebApp.mockReturnValue(null);
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    vi.stubGlobal("fetch", apiFetch);

    await expect(api.get("/whoami")).rejects.toBeInstanceOf(ApiError);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(isTelegramSessionExpired()).toBe(false);
  });
});
// [END: module]
