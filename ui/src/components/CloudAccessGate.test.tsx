/**
 * FILE: ui/src/components/CloudAccessGate.test.tsx
 * ABOUT: CloudAccessGate.test.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - proves CloudAccessGate renders inside Telegram once the bearer carries auth.
 */
// ==========================================
// [META: module]
// INTENT: Finding 1 from review: CloudAccessGate wraps every routed page (App.tsx:421), calls
//   healthApi.get() unconditionally and, under deploymentMode "authenticated", authApi.getSession() --
//   both raw fetch() calls that did not carry the Telegram bearer, so even after useTelegramSession
//   successfully minted a token, the Mini App would still 401 on get-session and redirect to /auth (a
//   page that cannot be completed inside a Telegram webview). A test asserting only that a header was
//   attached would not catch this -- this asserts the actual rendered outcome: with a bearer held and
//   deploymentMode "authenticated", CloudAccessGate must render its Outlet, not <Navigate to="/auth">.
//   The mocked /api/auth/get-session handler below enforces the header requirement itself (401 without
//   it, 200 with it) so the test fails the old way if the header regresses.
// PSEUDOCODE: 1. Mock ../telegram/webapp and @/context/CompanyContext (CloudAccessGate's Navigate/
//   useLocation route through the company-prefix shim, which needs a company). 2. Mint a real bearer
//   via the real useTelegramSession hook against a stubbed fetch. 3. Render CloudAccessGate with a
//   marker child route through MemoryRouter, with fetch stubbed to require the bearer on get-session.
//   4. Assert the marker renders (not the /auth redirect) when the bearer is present, and does redirect
//   when it is missing (proving the test would have caught the pre-fix regression).
// JSON_FLOW: {"file": "ui/src/components/CloudAccessGate.test.tsx", "imports": "react-dom, react-dom/client, react-router-dom, @tanstack/react-query, vitest, ../telegram/webapp, ./CloudAccessGate", "exports": "none"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramWebApp } from "../telegram/webapp";

const getTelegramWebApp = vi.fn<() => TelegramWebApp | null>();
vi.mock("../telegram/webapp", () => ({
  getTelegramWebApp: () => getTelegramWebApp(),
}));

// CloudAccessGate's Navigate/useLocation go through the @/lib/router company-prefix shim, which reads
// useCompany() -- the only piece of company context it needs (same rationale as
// TelegramBottomNav.test.tsx).
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: { id: "company-1", issuePrefix: "PAP" },
    companies: [{ id: "company-1", issuePrefix: "PAP" }],
  }),
}));

const { useTelegramSession, clearTelegramBearer, getTelegramBearer } = await import("../telegram/useTelegramSession");
const { CloudAccessGate } = await import("./CloudAccessGate");

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

async function mintBearer(token: string): Promise<void> {
  getTelegramWebApp.mockReturnValue(fakeApp);
  window.history.pushState({}, "", "/board?c=company-1");
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

/**
 * A fetch stub shaped like the real deployment: /api/health reports authenticated mode,
 * /api/auth/get-session requires the caller's own Authorization header to match `expectedBearer` (401
 * otherwise -- there is no session cookie inside the Telegram webview), and /api/cli-auth/me reports
 * board access once a session exists. This is what makes the test fail the way the real bug failed if
 * the header regresses, instead of only checking that a header object was built somewhere.
 */
function stubGateFetch(expectedBearer: string | null) {
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (url === "/api/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          deploymentMode: "authenticated",
          deploymentExposure: "private",
          bootstrapStatus: "ready",
          bootstrapInviteActive: false,
        }),
        { status: 200 },
      );
    }
    if (url === "/api/auth/get-session") {
      if (!expectedBearer || headers.get("authorization") !== `Bearer ${expectedBearer}`) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      }
      return new Response(
        JSON.stringify({
          session: { id: "paperclip:telegram_miniapp:user-1", userId: "user-1" },
          user: { id: "user-1", email: "operator@example.com", name: "Operator", image: null },
        }),
        { status: 200 },
      );
    }
    if (url === "/api/cli-auth/me") {
      return new Response(
        JSON.stringify({
          user: { id: "user-1", email: "operator@example.com", name: "Operator", image: null },
          userId: "user-1",
          isInstanceAdmin: false,
          companyIds: ["company-1"],
          source: "telegram_miniapp",
          keyId: null,
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

function renderGate(container: HTMLDivElement): Root {
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  flushSync(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/PAP/dashboard"]}>
          <Routes>
            <Route path=":companyPrefix" element={<CloudAccessGate />}>
              <Route path="dashboard" element={<div data-testid="board">board content</div>} />
            </Route>
            <Route path="/auth" element={<div data-testid="auth-redirect">auth page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return root;
}

describe("CloudAccessGate under the Telegram Mini App", () => {
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
  });

  afterEach(() => {
    if (root) flushSync(() => root?.unmount());
    container.remove();
    window.history.pushState({}, "", `${window.location.pathname}${originalSearch}`);
    clearTelegramBearer();
    vi.unstubAllGlobals();
  });

  it("renders the routed board once the bearer carries get-session, under deploymentMode authenticated", async () => {
    await mintBearer("tok_gate");
    stubGateFetch("tok_gate");

    root = renderGate(container);
    await waitForAssertion(() => {
      expect(container.querySelector('[data-testid="board"]')).toBeTruthy();
    });
    expect(container.querySelector('[data-testid="auth-redirect"]')).toBeFalsy();
  });

  // Proves this test would have caught the pre-fix regression: without a bearer on the get-session
  // request, the same authenticated-mode deployment redirects to /auth instead of rendering the board.
  it("redirects to /auth when get-session does not see the bearer (regression guard)", async () => {
    await mintBearer("tok_gate");
    stubGateFetch(null);

    root = renderGate(container);
    await waitForAssertion(() => {
      expect(container.querySelector('[data-testid="auth-redirect"]')).toBeTruthy();
    });
    expect(container.querySelector('[data-testid="board"]')).toBeFalsy();
  });
});
// [END: module]
