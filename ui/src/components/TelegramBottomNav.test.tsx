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
//   `uiContributions()` name the task brief guessed. Harness modeled on Artifacts.test.tsx
//   (react-dom/client createRoot + flushSync; @testing-library/react is not installed in this repo).
// PSEUDOCODE: 1. Mock pluginsApi.listUiContributions. 2. Render with QueryClientProvider + MemoryRouter
//   via createRoot/flushSync. 3. Poll container text/DOM until the async query resolves. 4. Assert core
//   items, Wikis presence/absence, and the nav's accessible label.
// JSON_FLOW: {"file": "ui/src/components/TelegramBottomNav.test.tsx", "imports": "react-dom, react-dom/client, @tanstack/react-query, react-router-dom, vitest, @/api/plugins", "exports": "none"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginUiContribution } from "@/api/plugins";
import { TelegramBottomNav, TELEGRAM_NAV_ITEMS } from "./TelegramBottomNav";

const listUiContributions = vi.fn();
vi.mock("@/api/plugins", () => ({
  pluginsApi: { listUiContributions: () => listUiContributions() },
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
  flushSync(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TelegramBottomNav />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return root;
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

  // There is no /wikis route — the entry is resolved from the installed plugin's page slot, or omitted.
  it("adds Wikis pointing at the installed wiki plugin", async () => {
    listUiContributions.mockResolvedValue([wikiContribution]);
    root = renderNav(container);
    await waitForAssertion(() => {
      const link = [...container.querySelectorAll("a")].find((a) => a.textContent === "Wikis");
      expect(link).toBeTruthy();
      expect(link?.getAttribute("href")).toBe("/plugins/plg_abc123");
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
