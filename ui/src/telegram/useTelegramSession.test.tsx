/**
 * FILE: ui/src/telegram/useTelegramSession.test.tsx
 * ABOUT: useTelegramSession.test.tsx (telegram module).
 *
 * SECTIONS:
 *   [TAG: module] - coverage for the Mini App session bootstrap.
 */
// ==========================================
// [META: module]
// INTENT: Prove the bootstrap is a no-op outside Telegram (the load-bearing guarantee for the rest of
//   the UI suite), that it mints and stores a bearer on success, that it reports a distinct message for
//   each failure mode (missing ?c=, 401 unlinked account, other HTTP failure, network failure) -- the
//   caller renders `error` verbatim, so the message text is behavior, not incidental -- and that
//   applyTelegramAuthHeader (shared by client.ts, health.ts and auth.ts) behaves correctly, and that
//   markTelegramSessionExpired -- what a 401 now triggers instead of an impossible re-mint -- drops the
//   bearer and drives every mounted hook to a terminal, actionable "reopen from Telegram" state.
// PSEUDOCODE: 1. Mock ./webapp's getTelegramWebApp so tests control Telegram presence/initData.
//   2. Stub global fetch to control the /api/telegram/miniapp/session response per test.
//   3. Render a probe component through useTelegramSession and poll its rendered status/error.
//   4. Separately assert getTelegramBearer()/clearTelegramBearer() against the module's bearer state,
//   applyTelegramAuthHeader() against a header-building caller's contract, and markTelegramSessionExpired()
//   against both the module state and a mounted hook.
// JSON_FLOW: {"file": "ui/src/telegram/useTelegramSession.test.tsx", "imports": "react-dom, react-dom/client, vitest, ./webapp, ./useTelegramSession", "exports": "none"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramWebApp } from "./webapp";

const getTelegramWebApp = vi.fn<() => TelegramWebApp | null>();
vi.mock("./webapp", () => ({
  getTelegramWebApp: () => getTelegramWebApp(),
}));

// Imported after the mock so the hook picks up the mocked ./webapp.
const {
  useTelegramSession,
  getTelegramBearer,
  clearTelegramBearer,
  applyTelegramAuthHeader,
  markTelegramSessionExpired,
  isTelegramSessionExpired,
  resetTelegramSessionExpiry,
  TELEGRAM_SESSION_EXPIRED_MESSAGE,
} = await import("./useTelegramSession");

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

function Probe() {
  const { status, error } = useTelegramSession();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error ?? ""}</span>
    </div>
  );
}

function renderProbe(container: HTMLDivElement): Root {
  const root = createRoot(container);
  flushSync(() => {
    root.render(<Probe />);
  });
  return root;
}

function statusText(container: HTMLDivElement): string {
  return container.querySelector('[data-testid="status"]')?.textContent ?? "";
}

function errorText(container: HTMLDivElement): string {
  return container.querySelector('[data-testid="error"]')?.textContent ?? "";
}

const fakeApp: TelegramWebApp = { initData: "query_id=fake&user=fake" };

describe("useTelegramSession", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let originalSearch: string;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    originalSearch = window.location.search;
    getTelegramWebApp.mockReset();
    clearTelegramBearer();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    if (root) flushSync(() => root?.unmount());
    container.remove();
    window.history.pushState({}, "", `${window.location.pathname}${originalSearch}`);
    clearTelegramBearer();
    vi.unstubAllGlobals();
  });

  it("stays idle and never calls fetch outside Telegram", async () => {
    getTelegramWebApp.mockReturnValue(null);
    window.history.pushState({}, "", "/board?c=company-1");
    root = renderProbe(container);
    await flush();
    expect(statusText(container)).toBe("idle");
    expect(fetch).not.toHaveBeenCalled();
    expect(getTelegramBearer()).toBeNull();
  });

  it("fails with a company-missing message when ?c= is absent", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    window.history.pushState({}, "", "/board");
    root = renderProbe(container);
    await waitForAssertion(() => {
      expect(statusText(container)).toBe("failed");
    });
    expect(errorText(container)).toMatch(/missing its company/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("mints and stores a bearer on success", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    window.history.pushState({}, "", "/board?c=company-1");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: "tok_123" }), { status: 200 }),
    );
    root = renderProbe(container);
    await waitForAssertion(() => {
      expect(statusText(container)).toBe("ready");
    });
    expect(getTelegramBearer()).toBe("tok_123");
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/telegram/miniapp/session");
    expect(JSON.parse(init.body as string)).toEqual({ companyId: "company-1", initData: fakeApp.initData });
  });

  it("fails with an unlinked-account message on 401", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    window.history.pushState({}, "", "/board?c=company-1");
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 401 }));
    root = renderProbe(container);
    await waitForAssertion(() => {
      expect(statusText(container)).toBe("failed");
    });
    expect(errorText(container)).toMatch(/not linked/i);
    expect(getTelegramBearer()).toBeNull();
  });

  it("fails with a generic message on other HTTP errors", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    window.history.pushState({}, "", "/board?c=company-1");
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }));
    root = renderProbe(container);
    await waitForAssertion(() => {
      expect(statusText(container)).toBe("failed");
    });
    expect(errorText(container)).toMatch(/could not start/i);
  });

  it("fails with an unreachable message when fetch throws", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    window.history.pushState({}, "", "/board?c=company-1");
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    root = renderProbe(container);
    await waitForAssertion(() => {
      expect(statusText(container)).toBe("failed");
    });
    expect(errorText(container)).toMatch(/could not reach/i);
  });

  it("clearTelegramBearer resets the module-level bearer", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    window.history.pushState({}, "", "/board?c=company-1");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: "tok_456" }), { status: 200 }),
    );
    root = renderProbe(container);
    await waitForAssertion(() => {
      expect(getTelegramBearer()).toBe("tok_456");
    });
    clearTelegramBearer();
    expect(getTelegramBearer()).toBeNull();
  });
});

describe("applyTelegramAuthHeader", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let originalSearch: string;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    originalSearch = window.location.search;
    getTelegramWebApp.mockReset();
    clearTelegramBearer();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    if (root) flushSync(() => root?.unmount());
    container.remove();
    window.history.pushState({}, "", `${window.location.pathname}${originalSearch}`);
    clearTelegramBearer();
    vi.unstubAllGlobals();
  });

  it("sets no Authorization header when no bearer is held (outside Telegram)", () => {
    expect(getTelegramBearer()).toBeNull();
    const headers = new Headers();
    applyTelegramAuthHeader(headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("sets the Authorization header once a bearer has been minted", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    window.history.pushState({}, "", "/board?c=company-1");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: "tok_header" }), { status: 200 }),
    );
    root = createRoot(container);
    flushSync(() => {
      root!.render(<Probe />);
    });
    await waitForAssertion(() => expect(getTelegramBearer()).toBe("tok_header"));

    const headers = new Headers();
    applyTelegramAuthHeader(headers);
    expect(headers.get("authorization")).toBe("Bearer tok_header");
  });

  it("never overwrites a caller-supplied Authorization header", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    window.history.pushState({}, "", "/board?c=company-1");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: "tok_header" }), { status: 200 }),
    );
    root = createRoot(container);
    flushSync(() => {
      root!.render(<Probe />);
    });
    await waitForAssertion(() => expect(getTelegramBearer()).toBe("tok_header"));

    const headers = new Headers({ authorization: "Bearer caller-supplied" });
    applyTelegramAuthHeader(headers);
    expect(headers.get("authorization")).toBe("Bearer caller-supplied");
  });
});

describe("markTelegramSessionExpired", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let originalSearch: string;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    originalSearch = window.location.search;
    getTelegramWebApp.mockReset();
    clearTelegramBearer();
    resetTelegramSessionExpiry();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    if (root) flushSync(() => root?.unmount());
    container.remove();
    window.history.pushState({}, "", `${window.location.pathname}${originalSearch}`);
    clearTelegramBearer();
    resetTelegramSessionExpiry();
    vi.unstubAllGlobals();
  });

  it("drops the bearer and records the session as terminally expired", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    window.history.pushState({}, "", "/board?c=company-9");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: "tok_live" }), { status: 200 }),
    );
    root = renderProbe(container);
    await waitForAssertion(() => expect(getTelegramBearer()).toBe("tok_live"));

    markTelegramSessionExpired();

    expect(getTelegramBearer()).toBeNull();
    expect(isTelegramSessionExpired()).toBe(true);
  });

  // The whole point of dropping the old retry-and-re-mint: expiry has to reach the operator, because
  // nothing in the webview can fix it for them.
  it("flips a mounted hook to the terminal expired state with an actionable message", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    window.history.pushState({}, "", "/board?c=company-9");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: "tok_live" }), { status: 200 }),
    );
    root = renderProbe(container);
    await waitForAssertion(() => expect(statusText(container)).toBe("ready"));

    markTelegramSessionExpired();

    await waitForAssertion(() => expect(statusText(container)).toBe("expired"));
    expect(errorText(container)).toBe(TELEGRAM_SESSION_EXPIRED_MESSAGE);
    expect(errorText(container)).toMatch(/reopen paperclip from telegram/i);
  });

  it("never issues a re-mint request of its own", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    window.history.pushState({}, "", "/board?c=company-9");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: "tok_live" }), { status: 200 }),
    );
    root = renderProbe(container);
    await waitForAssertion(() => expect(getTelegramBearer()).toBe("tok_live"));
    const before = vi.mocked(fetch).mock.calls.length;

    markTelegramSessionExpired();
    await flush();

    expect(vi.mocked(fetch).mock.calls.length).toBe(before);
  });

  it("reports the expired state to a hook mounted after the fact", async () => {
    getTelegramWebApp.mockReturnValue(null);
    markTelegramSessionExpired();
    root = renderProbe(container);
    await waitForAssertion(() => expect(statusText(container)).toBe("expired"));
  });
});

// [END: module]
