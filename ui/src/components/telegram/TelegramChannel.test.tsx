/**
 * FILE: ui/src/components/telegram/TelegramChannel.test.tsx
 * ABOUT: TelegramChannel.test.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - operator-surface tests for the Telegram channel settings panel.
 */
// ==========================================
// [META: module]
// INTENT: The panel tells an operator whether Telegram is set up, lets them register a bot, issue a
//   one-time link code, and revoke a linked chat — and never displays a bot token it was not just given.
// PSEUDOCODE: 1. Mock telegramApi. 2. Render. 3. Assert states and click behaviour.
// JSON_FLOW: {"file": "ui/src/components/telegram/TelegramChannel.test.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  putConfig: vi.fn(),
  removeConfig: vi.fn(),
  createLinkCode: vi.fn(),
  listBindings: vi.fn(),
  revokeBinding: vi.fn(),
}));

vi.mock("../../api/telegram", () => ({
  telegramApi: {
    getConfig: apiMocks.getConfig,
    putConfig: apiMocks.putConfig,
    removeConfig: apiMocks.removeConfig,
    createLinkCode: apiMocks.createLinkCode,
    listBindings: apiMocks.listBindings,
    revokeBinding: apiMocks.revokeBinding,
  },
}));

import { TelegramChannel } from "./TelegramChannel";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("TelegramChannel", () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let root: ReturnType<typeof createRoot> | undefined;

  beforeEach(() => {
    for (const mock of Object.values(apiMocks)) mock.mockReset();
    apiMocks.getConfig.mockResolvedValue({ configured: false });
    apiMocks.listBindings.mockResolvedValue([]);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } } });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  async function render() {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <TelegramChannel companyId="company-1" />
        </QueryClientProvider>,
      );
    });
    // The bindings query only starts once the config query says "connected", so flush a few times
    // to let that second round settle and re-render before asserting.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  /** React tracks the last value it wrote, so a bare `.value =` is ignored; go through the setter. */
  async function typeInto(label: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function click(selector: string) {
    const el = container.querySelector<HTMLButtonElement>(selector);
    if (!el) throw new Error(`no element for ${selector}`);
    return act(async () => {
      el.click();
    });
  }

  it("invites the operator to connect a bot when none is configured", async () => {
    await render();
    expect(container.textContent).toContain("Not connected");
  });

  it("saves a bot token and stops showing it once saved", async () => {
    apiMocks.putConfig.mockResolvedValue({ ok: true, webhookPath: "/api/telegram/webhook/company-1" });
    await render();

    await typeInto("Bot token", "123456789:AA-token");
    await click('button[data-testid="telegram-save"]');

    expect(apiMocks.putConfig).toHaveBeenCalledWith("company-1", expect.objectContaining({ botToken: "123456789:AA-token" }));
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Bot token"]')!.value).toBe("");
  });

  it("sends the public base URL so approval cards can carry a deep link", async () => {
    apiMocks.putConfig.mockResolvedValue({ ok: true, webhookPath: "/w", webhookSecret: "s" });
    await render();

    await typeInto("Bot token", "123456789:AA-token");
    await typeInto("Public base URL", "https://ops.example.com");
    await click('button[data-testid="telegram-save"]');

    expect(apiMocks.putConfig).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ publicBaseUrl: "https://ops.example.com" }),
    );
  });

  it("prefills the public base URL already saved for the company", async () => {
    apiMocks.getConfig.mockResolvedValue({
      configured: true,
      botUsername: "acme_bot",
      enabled: true,
      publicBaseUrl: "https://ops.example.com",
      webhookPath: "/w",
    });
    await render();

    expect(container.querySelector<HTMLInputElement>('input[aria-label="Public base URL"]')!.value).toBe(
      "https://ops.example.com",
    );
  });

  it("reveals the webhook secret once after connecting, since setWebhook needs it", async () => {
    apiMocks.putConfig.mockResolvedValue({
      ok: true,
      webhookPath: "/api/telegram/webhook/company-1",
      webhookSecret: "s3cr3t-token",
    });
    await render();

    await typeInto("Bot token", "123456789:AA-token");
    await click('button[data-testid="telegram-save"]');

    const revealed = container.querySelector('[data-testid="telegram-webhook-secret"]');
    expect(revealed?.textContent).toContain("s3cr3t-token");
    expect(container.textContent).toMatch(/only once/i);
  });

  it("does not show a webhook secret before anything has been saved", async () => {
    apiMocks.getConfig.mockResolvedValue({
      configured: true,
      botUsername: "acme_bot",
      enabled: true,
      webhookPath: "/api/telegram/webhook/company-1",
    });
    await render();

    expect(container.querySelector('[data-testid="telegram-webhook-secret"]')).toBeNull();
  });

  it("shows the webhook path a connected bot must point at", async () => {
    apiMocks.getConfig.mockResolvedValue({
      configured: true,
      botUsername: "acme_bot",
      enabled: true,
      publicBaseUrl: null,
      webhookPath: "/api/telegram/webhook/company-1",
    });
    await render();

    expect(container.textContent).toContain("/api/telegram/webhook/company-1");
  });

  it("shows a freshly issued link code exactly once, with its deep link", async () => {
    apiMocks.getConfig.mockResolvedValue({ configured: true, botUsername: "acme_bot", enabled: true, webhookPath: "/w" });
    apiMocks.createLinkCode.mockResolvedValue({
      code: "abc123",
      expiresAt: "2026-08-06T13:00:00.000Z",
      deepLink: "https://t.me/acme_bot?start=abc123",
    });
    await render();

    await click('button[data-testid="telegram-link-code"]');

    expect(container.textContent).toContain("https://t.me/acme_bot?start=abc123");
  });

  it("lists linked chats and revokes one on demand", async () => {
    apiMocks.getConfig.mockResolvedValue({ configured: true, botUsername: "acme_bot", enabled: true, webhookPath: "/w" });
    apiMocks.listBindings.mockResolvedValue([
      { id: "bind-1", userId: "user-1", chatLabel: "Ops phone", linkedAt: "2026-08-01T00:00:00.000Z", lastUsedAt: null },
    ]);
    apiMocks.revokeBinding.mockResolvedValue({ ok: true });
    await render();

    expect(container.textContent).toContain("Ops phone");
    await click('button[data-testid="revoke-bind-1"]');

    expect(apiMocks.revokeBinding).toHaveBeenCalledWith("company-1", "bind-1");
  });

  it("says so when no chat is linked yet", async () => {
    apiMocks.getConfig.mockResolvedValue({ configured: true, botUsername: "acme_bot", enabled: true, webhookPath: "/w" });
    await render();

    expect(container.textContent).toContain("No chats linked");
  });
});
// [END: module]
