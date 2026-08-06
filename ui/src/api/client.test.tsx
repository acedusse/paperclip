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
//   the Authorization header on the real request. 4. For the 401 cases, dispatch the stub by URL so the
//   re-mint POST and the retried GET are distinguishable, and assert both the retry outcome and the
//   number of underlying calls.
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
const { useTelegramSession, getTelegramBearer, clearTelegramBearer } = await import("../telegram/useTelegramSession");
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

  it("on a 401, re-mints from initData and retries the request once with the fresh bearer", async () => {
    await mintBearer("tok_old", "company-7");

    let whoamiCalls = 0;
    const apiFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/telegram/miniapp/session") {
        return new Response(JSON.stringify({ token: "tok_new" }), { status: 200 });
      }
      void init;
      whoamiCalls += 1;
      if (whoamiCalls === 1) {
        return new Response(JSON.stringify({ error: "expired" }), { status: 401 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", apiFetch);

    const result = await api.get<{ ok: boolean }>("/whoami");

    expect(result).toEqual({ ok: true });
    expect(getTelegramBearer()).toBe("tok_new");
    const whoamiRequests = apiFetch.mock.calls.filter(([url]) => url === "/api/whoami");
    expect(whoamiRequests).toHaveLength(2);
    expect((whoamiRequests[0][1]?.headers as Headers).get("authorization")).toBe("Bearer tok_old");
    expect((whoamiRequests[1][1]?.headers as Headers).get("authorization")).toBe("Bearer tok_new");
  });

  it("propagates the original 401 as an ApiError when re-minting itself fails, without a second retry", async () => {
    await mintBearer("tok_old", "company-7");

    const apiFetch = vi.fn(async (url: string) => {
      if (url === "/api/telegram/miniapp/session") {
        return new Response(JSON.stringify({ error: "not_bound" }), { status: 401 });
      }
      return new Response(JSON.stringify({ error: "expired" }), { status: 401 });
    });
    vi.stubGlobal("fetch", apiFetch);

    await expect(api.get("/whoami")).rejects.toBeInstanceOf(ApiError);
    await expect(api.get("/whoami")).rejects.toMatchObject({ status: 401 });
    expect(getTelegramBearer()).toBeNull();
    const whoamiRequests = apiFetch.mock.calls.filter(([url]) => url === "/api/whoami");
    // Two calls to api.get() above, one underlying /api/whoami fetch each -- no extra retry beyond that.
    expect(whoamiRequests).toHaveLength(2);
  });

  it("does not attempt to re-mint on a 401 when no bearer was ever held (ordinary board)", async () => {
    getTelegramWebApp.mockReturnValue(null);
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    vi.stubGlobal("fetch", apiFetch);

    await expect(api.get("/whoami")).rejects.toBeInstanceOf(ApiError);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
// [END: module]
