/**
 * FILE: ui/src/components/TelegramBottomNav.test.tsx
 * ABOUT: TelegramBottomNav.test.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - coverage for the six-surface Telegram Mini App bottom nav.
 */
// ==========================================
// [META: module]
// INTENT: Prove the five fixed surfaces always render, that Wikis only appears when an installed
//   plugin's pluginKey/displayName looks like a wiki AND it declares a page slot to link to, and that
//   the nav is labelled for assistive tech. `pluginsApi.listUiContributions` is mocked at the real
//   name/shape verified against ui/src/api/plugins.ts and ui/src/plugins/launchers.tsx — not the
//   `uiContributions()` name the task brief guessed.
//
//   Critically, this renders through the REAL @/lib/router shim (only @/context/CompanyContext is
//   mocked, to supply a company), nested under a `:companyPrefix` route param exactly the way Layout
//   actually mounts TelegramBottomNav in production. A first version of this test used plain
//   react-router-dom + literal href strings inside a bare MemoryRouter with no registered routes — that
//   passed regardless of whether the resolved path existed, and missed that TELEGRAM_NAV_ITEMS'
//   absolute paths (/dashboard, /approvals/triage, /digest, /plugins/:id) have no unprefixed route and
//   404 in the running app (only boardRoutes() in App.tsx registers them, under `:companyPrefix`). This
//   version asserts the *prefixed* hrefs the shim actually produces, so reverting to a bare NavLink or
//   dropping the shim breaks these tests instead of passing silently.
// PSEUDOCODE: 1. Mock pluginsApi.listUiContributions and useCompany (selectedCompany.issuePrefix="PAP").
//   2. Render under MemoryRouter + Routes/Route(":companyPrefix/*") so the shim's useParams().
//   companyPrefix resolves, mirroring Layout's real nesting under App.tsx's `:companyPrefix` route.
//   3. Poll container text/DOM until the async query resolves. 4. Assert each nav item's rendered href
//   is prefixed with the resolved company (proving the shim ran), and cross-reference each target path
//   against the exact App.tsx line that registers it.
// JSON_FLOW: {"file": "ui/src/components/TelegramBottomNav.test.tsx", "imports": "react-dom, react-dom/client, @tanstack/react-query, react-router-dom, vitest, @/api/plugins, @/context/CompanyContext", "exports": "none"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginUiContribution } from "@/api/plugins";
import { TelegramBottomNav, TELEGRAM_NAV_ITEMS } from "./TelegramBottomNav";

const listUiContributions = vi.fn();
vi.mock("@/api/plugins", () => ({
  pluginsApi: { listUiContributions: () => listUiContributions() },
}));

// The @/lib/router shim's useActiveCompanyPrefix() reads useCompany() directly (ui/src/lib/router.tsx)
// — this is the only piece of company context it needs, so it's the only thing mocked. Everything else
// in this test runs through the real router module, including NavLink's prefix injection.
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: { id: "company-1", issuePrefix: "PAP" },
    companies: [{ id: "company-1", issuePrefix: "PAP" }],
  }),
}));

// Shaped exactly as GET /api/plugins/ui-contributions returns it (see
// ui/src/api/plugins.ts and server/src/routes/plugins.ts): `pluginId` is the plugin's opaque database
// id, never a human-readable name — `pluginKey` (manifest id) and `displayName` are the name signals.
const wikiContribution: PluginUiContribution = {
  pluginId: "plg_abc123",
  pluginKey: "paperclipai.plugin-llm-wiki",
  displayName: "LLM Wiki",
  version: "0.1.0",
  uiEntryFile: "index.js",
  slots: [
    { type: "page", id: "wiki-page", displayName: "Wiki", exportName: "WikiPage", routePath: "wiki" },
  ],
  launchers: [],
};

// Each target below is a real <Route path="..."> registered inside boardRoutes(), which App.tsx only
// mounts as a child of <Route path=":companyPrefix" element={<Layout />}> — there is no unprefixed
// equivalent. Citing the exact registrations so this map breaks visibly, not silently, if App.tsx's
// route table ever moves without updating TELEGRAM_NAV_ITEMS.
//   dashboard         -> App.tsx:96  <Route path="dashboard" .../>
//   issues             -> App.tsx:146 <Route path="issues" .../>
//   approvals/triage  -> App.tsx:172 <Route path="approvals/triage" .../>
//   digest             -> App.tsx:174 <Route path="digest" .../>
//   artifacts          -> App.tsx:168 <Route path="artifacts" .../>
//   plugins/:pluginId  -> App.tsx:125 <Route path="plugins/:pluginId" .../>
const EXPECTED_PREFIXED_HREFS: Record<string, string> = {
  Dashboard: "/PAP/dashboard",
  Tasks: "/PAP/issues",
  Triage: "/PAP/approvals/triage",
  Digest: "/PAP/digest",
  Artifacts: "/PAP/artifacts",
};

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

function renderNav(container: HTMLDivElement): Root {
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Nest under a `:companyPrefix` route param, exactly how App.tsx mounts Layout (and therefore
  // TelegramBottomNav) in production: <Route path=":companyPrefix" element={<Layout />}>. Without this,
  // the shim's useParams().companyPrefix would be empty and the test would prove nothing about prefix
  // injection.
  flushSync(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/PAP/telegram-nav-under-test"]}>
          <Routes>
            <Route path=":companyPrefix/*" element={<TelegramBottomNav />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return root;
}

function linkHref(container: HTMLDivElement, label: string): string | null {
  const link = [...container.querySelectorAll("a")].find((a) => a.textContent === label);
  return link?.getAttribute("href") ?? null;
}

describe("TelegramBottomNav", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    listUiContributions.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    if (root) flushSync(() => root?.unmount());
    container.remove();
  });

  it("renders the five core surfaces", async () => {
    root = renderNav(container);
    await waitForAssertion(() => {
      for (const label of ["Dashboard", "Tasks", "Triage", "Digest", "Artifacts"]) {
        expect(container.textContent).toContain(label);
      }
    });
  });

  it("points each core item at its route", () => {
    expect(TELEGRAM_NAV_ITEMS.map((i) => i.to)).toEqual([
      "/dashboard",
      "/issues",
      "/approvals/triage",
      "/digest",
      "/artifacts",
    ]);
  });

  // This is the regression guard for the bug the review caught: TelegramBottomNav previously imported
  // NavLink from plain react-router-dom, so these hrefs rendered as the bare, unregistered
  // /dashboard, /approvals/triage, /digest paths and 404'd (only /issues and /artifacts happened to
  // have unprefixed UnprefixedBoardRedirect routes). Asserting the *company-prefixed* href — which only
  // the @/lib/router shim produces — fails again if that import regresses.
  it("resolves every core item to its company-prefixed, registered route", async () => {
    root = renderNav(container);
    await waitForAssertion(() => {
      for (const [label, expectedHref] of Object.entries(EXPECTED_PREFIXED_HREFS)) {
        expect(linkHref(container, label)).toBe(expectedHref);
      }
    });
  });

  // There is no /wikis route — the entry is resolved from the installed plugin's page slot, or omitted.
  it("adds Wikis pointing at the installed wiki plugin's company-prefixed page route", async () => {
    listUiContributions.mockResolvedValue([wikiContribution]);
    root = renderNav(container);
    await waitForAssertion(() => {
      expect(linkHref(container, "Wikis")).toBe("/PAP/plugins/plg_abc123");
    });
  });

  it("omits Wikis entirely when no wiki plugin is installed", async () => {
    root = renderNav(container);
    await waitForAssertion(() => {
      expect(container.textContent).toContain("Dashboard");
    });
    expect(container.textContent).not.toContain("Wikis");
  });

  it("omits Wikis when a name-matched plugin declares no page slot", async () => {
    listUiContributions.mockResolvedValue([{ ...wikiContribution, slots: [] }]);
    root = renderNav(container);
    await waitForAssertion(() => {
      expect(container.textContent).toContain("Dashboard");
    });
    expect(container.textContent).not.toContain("Wikis");
  });

  it("is labelled for assistive technology", () => {
    root = renderNav(container);
    expect(container.querySelector('nav[aria-label="Telegram navigation"]')).toBeTruthy();
  });
});
// [END: module]
