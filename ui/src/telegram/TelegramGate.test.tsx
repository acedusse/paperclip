/**
 * FILE: ui/src/telegram/TelegramGate.test.tsx
 * ABOUT: TelegramGate.test.tsx (telegram module).
 *
 * SECTIONS:
 *   [TAG: module] - coverage for the Mini App render gate's three branches.
 */
// ==========================================
// [META: module]
// INTENT: Prove the seam between useTelegramSession's status and what TelegramGate actually renders:
//   a pass-through outside Telegram (the load-bearing guarantee for the rest of the UI), a
//   "Connecting..." placeholder while not yet ready, the failure text (verbatim, since the hook's error
//   string is user-facing) when status is "failed", and children once ready. Also proves the Telegram
//   lifecycle calls (ready/expand/applyTelegramTheme, and re-applying on themeChanged) only fire inside
//   Telegram.
// PSEUDOCODE: 1. Mock ./webapp and ./useTelegramSession so status/error and Telegram presence are
//   controlled per test. 2. Render TelegramGate with a marker child through createRoot/flushSync.
//   3. Assert which of {children, "Connecting...", the failure text} is present for each status.
//   4. Assert app.ready()/expand()/applyTelegramTheme calls only happen when getTelegramWebApp() is
//   non-null.
// JSON_FLOW: {"file": "ui/src/telegram/TelegramGate.test.tsx", "imports": "react-dom, react-dom/client, vitest, ./webapp, ./useTelegramSession, ./TelegramGate", "exports": "none"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramWebApp } from "./webapp";
import type { TelegramSessionStatus } from "./useTelegramSession";

const getTelegramWebApp = vi.fn<() => TelegramWebApp | null>();
const applyTelegramTheme = vi.fn();
vi.mock("./webapp", () => ({
  getTelegramWebApp: () => getTelegramWebApp(),
  applyTelegramTheme: (...args: unknown[]) => applyTelegramTheme(...args),
}));

const sessionState = vi.hoisted(() => ({
  status: "idle" as TelegramSessionStatus,
  error: null as string | null,
}));
vi.mock("./useTelegramSession", () => ({
  useTelegramSession: () => sessionState,
}));

const { TelegramGate } = await import("./TelegramGate");

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function renderGate(container: HTMLDivElement): Root {
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <TelegramGate>
        <div data-testid="board">board content</div>
      </TelegramGate>,
    );
  });
  return root;
}

const fakeApp: TelegramWebApp = {
  initData: "query_id=fake",
  ready: vi.fn(),
  expand: vi.fn(),
  onEvent: vi.fn(),
};

describe("TelegramGate", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    getTelegramWebApp.mockReset();
    applyTelegramTheme.mockReset();
    sessionState.status = "idle";
    sessionState.error = null;
    vi.mocked(fakeApp.ready!).mockReset();
    vi.mocked(fakeApp.expand!).mockReset();
    vi.mocked(fakeApp.onEvent!).mockReset();
  });

  afterEach(() => {
    if (root) flushSync(() => root?.unmount());
    container.remove();
  });

  it("renders children directly outside Telegram, regardless of session status", async () => {
    getTelegramWebApp.mockReturnValue(null);
    sessionState.status = "idle";
    root = renderGate(container);
    await flush();
    expect(container.querySelector('[data-testid="board"]')).toBeTruthy();
    expect(container.textContent).not.toContain("Connecting");
  });

  it("does not call the Telegram lifecycle hooks outside Telegram", async () => {
    getTelegramWebApp.mockReturnValue(null);
    root = renderGate(container);
    await flush();
    expect(applyTelegramTheme).not.toHaveBeenCalled();
  });

  it("shows Connecting while inside Telegram and not yet ready", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    sessionState.status = "authenticating";
    root = renderGate(container);
    await flush();
    expect(container.textContent).toContain("Connecting");
    expect(container.querySelector('[data-testid="board"]')).toBeFalsy();
  });

  it("shows the hook's failure message verbatim and withholds children", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    sessionState.status = "failed";
    sessionState.error = "This Telegram account is not linked to Paperclip. Link it from the board, then reopen.";
    root = renderGate(container);
    await flush();
    expect(container.textContent).toContain(
      "This Telegram account is not linked to Paperclip. Link it from the board, then reopen.",
    );
    expect(container.querySelector('[data-testid="board"]')).toBeFalsy();
  });

  it("renders children once the session is ready", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    sessionState.status = "ready";
    root = renderGate(container);
    await flush();
    expect(container.querySelector('[data-testid="board"]')).toBeTruthy();
    expect(container.textContent).not.toContain("Connecting");
  });

  it("runs the Telegram lifecycle (ready/expand/theme) once inside Telegram", async () => {
    getTelegramWebApp.mockReturnValue(fakeApp);
    sessionState.status = "ready";
    root = renderGate(container);
    await flush();
    expect(fakeApp.ready).toHaveBeenCalled();
    expect(fakeApp.expand).toHaveBeenCalled();
    expect(applyTelegramTheme).toHaveBeenCalledWith(fakeApp, document.documentElement);
    expect(fakeApp.onEvent).toHaveBeenCalledWith("themeChanged", expect.any(Function));
  });
});
// [END: module]
