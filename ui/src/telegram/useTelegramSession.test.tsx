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
//   applyTelegramAuthHeader/refreshTelegramBearer (shared by client.ts, health.ts and auth.ts) behave
//   correctly for the expiry-then-recovery path a 401 triggers.
// PSEUDOCODE: 1. Mock ./webapp's getTelegramWebApp so tests control Telegram presence/initData.
//   2. Stub global fetch to control the /api/telegram/miniapp/session response per test.
//   3. Render a probe component through useTelegramSession and poll its rendered status/error.
//   4. Separately assert getTelegramBearer()/clearTelegramBearer() against the module's bearer state,
//   and refreshTelegramBearer()/applyTelegramAuthHeader() against a header-building caller's contract.
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
const { useTelegramSession, getTelegramBearer, clearTelegramBearer, applyTelegramAuthHeader, refreshTelegramBearer } =
  await import("./useTelegramSession");

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

describe("refreshTelegramBearer", () => {
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

  it("returns null outside Telegram", async () => {
    getTelegramWebApp.mockReturnValue(null);
    await expect(refreshTelegramBearer()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  // (No companyId ever bound is covered structurally, not as a standalone test: boundCompanyId is
  // private module state set only by a successful mint and intentionally never cleared by
  // clearTelegramBearer -- see its doc comment in useTelegramSession.ts -- so once any test in this
  // file's shared module instance has minted successfully, "never bound" can no longer be reproduced in
  // isolation here without a test-only reset hook this module deliberately doesn't expose.)

  it("re-mints against the last-bound companyId and stores the fresh token (expiry-then-recovery)", async () => {
    // Bootstrap a real bearer through the hook first, exactly like an API client's first successful
    // request would have observed, so this test exercises the actual companyId-binding path rather than
    // asserting against hand-set internal state.
    getTelegramWebApp.mockReturnValue(fakeApp);
    window.history.pushState({}, "", "/board?c=company-9");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "tok_expiring" }), { status: 200 }),
    );
    root = createRoot(container);
    flushSync(() => {
      root!.render(<Probe />);
    });
    await waitForAssertion(() => expect(getTelegramBearer()).toBe("tok_expiring"));

    // Simulate the 12-hour token having expired: the caller (client.ts) clears nothing itself --
    // refreshTelegramBearer does both the clear and the re-mint.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "tok_fresh" }), { status: 200 }),
    );
    const fresh = await refreshTelegramBearer();

    expect(fresh).toBe("tok_fresh");
    expect(getTelegramBearer()).toBe("tok_fresh");
    const mintCalls = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/telegram/miniapp/session");
    expect(mintCalls).toHaveLength(2);
    const [, secondInit] = mintCalls[1] as [string, RequestInit];
    expect(JSON.parse(secondInit.body as string)).toEqual({
      companyId: "company-9",
      initData: fakeApp.initData,
    });
  });

  it("clears the bearer and returns null when the re-mint itself fails (binding revoked)", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    window.history.pushState({}, "", "/board?c=company-9");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "tok_expiring" }), { status: 200 }),
    );
    root = createRoot(container);
    flushSync(() => {
      root!.render(<Probe />);
    });
    await waitForAssertion(() => expect(getTelegramBearer()).toBe("tok_expiring"));

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 401 }));
    const fresh = await refreshTelegramBearer();

    expect(fresh).toBeNull();
    expect(getTelegramBearer()).toBeNull();
  });
});
// [END: module]
