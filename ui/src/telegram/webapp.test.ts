/**
 * FILE: ui/src/telegram/webapp.test.ts
 * ABOUT: webapp.test.ts (telegram module).
 *
 * SECTIONS:
 *   [TAG: module] - coverage for the window.Telegram.WebApp adapter.
 */
// ==========================================
// [META: module]
// INTENT: Pin the two things this adapter gets to decide. First, what counts as "inside Telegram": an
//   injected global with a non-empty initData, and nothing else -- every other module's Telegram guard
//   is this predicate, so a wrong answer here either breaks the ordinary board or authenticates a page
//   that cannot prove anything. Second, that applyTelegramTheme drives the board's *actual* dark mode
//   (the `dark` class ThemeContext toggles) rather than a data-theme attribute nothing reads: the
//   themeParams it writes are inline styles that outrank the class-scoped defaults, so a discarded
//   colorScheme means Telegram's near-white dark text painted onto light cards.
// PSEUDOCODE: 1. Set and clear window.Telegram between tests. 2. Assert getTelegramWebApp/
//   isTelegramWebApp for absent, empty-initData and valid globals. 3. Apply themes to a detached
//   element and assert the CSS custom properties, the dark class, and root.style.colorScheme.
// JSON_FLOW: {"file": "ui/src/telegram/webapp.test.ts", "imports": "vitest, ./webapp", "exports": "none"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { applyTelegramTheme, getTelegramWebApp, isTelegramWebApp, type TelegramWebApp } from "./webapp";

function setTelegram(app: unknown): void {
  (window as unknown as { Telegram?: unknown }).Telegram = app === undefined ? undefined : { WebApp: app };
}

describe("getTelegramWebApp", () => {
  afterEach(() => {
    delete (window as unknown as { Telegram?: unknown }).Telegram;
  });

  it("returns null when Telegram injected nothing", () => {
    setTelegram(undefined);
    expect(getTelegramWebApp()).toBeNull();
    expect(isTelegramWebApp()).toBe(false);
  });

  it("returns null for an empty initData (opened outside Telegram, or imitated)", () => {
    setTelegram({ initData: "" });
    expect(getTelegramWebApp()).toBeNull();
    expect(isTelegramWebApp()).toBe(false);
  });

  it("returns the WebApp object when a non-empty initData is present", () => {
    const app = { initData: "user=%7B%22id%22%3A7%7D&hash=abc" };
    setTelegram(app);
    expect(getTelegramWebApp()).toBe(app);
    expect(isTelegramWebApp()).toBe(true);
  });
});

describe("applyTelegramTheme", () => {
  function freshRoot(): HTMLElement {
    const root = document.createElement("div");
    document.body.appendChild(root);
    return root;
  }

  it("maps themeParams onto the board's CSS custom properties", () => {
    const root = freshRoot();
    const app: TelegramWebApp = {
      initData: "x",
      themeParams: {
        bg_color: "#17212b",
        text_color: "#f5f5f5",
        hint_color: "#708499",
        button_color: "#5288c1",
        button_text_color: "#ffffff",
      },
    };

    applyTelegramTheme(app, root);

    expect(root.style.getPropertyValue("--background")).toBe("#17212b");
    expect(root.style.getPropertyValue("--foreground")).toBe("#f5f5f5");
    expect(root.style.getPropertyValue("--muted-foreground")).toBe("#708499");
    expect(root.style.getPropertyValue("--primary")).toBe("#5288c1");
    expect(root.style.getPropertyValue("--primary-foreground")).toBe("#ffffff");
  });

  // The regression this file exists for: colorScheme has to reach the mechanism the board's stylesheet
  // actually keys on, which is the `dark` class (ThemeContext.applyTheme), not a data-theme attribute.
  it("puts the board into dark mode via the dark class, not a data-theme attribute", () => {
    const root = freshRoot();

    applyTelegramTheme({ initData: "x", colorScheme: "dark" }, root);

    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
    expect(root.getAttribute("data-theme")).toBeNull();
  });

  it("removes the dark class when Telegram switches back to light", () => {
    const root = freshRoot();
    root.classList.add("dark");

    applyTelegramTheme({ initData: "x", colorScheme: "light" }, root);

    expect(root.classList.contains("dark")).toBe(false);
    expect(root.style.colorScheme).toBe("light");
  });

  it("leaves the board's existing theme alone when Telegram reports no colorScheme", () => {
    const root = freshRoot();
    root.classList.add("dark");

    applyTelegramTheme({ initData: "x", themeParams: { bg_color: "#000000" } }, root);

    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.getPropertyValue("--background")).toBe("#000000");
  });

  it("ignores themeParams keys Telegram did not send rather than writing empty values", () => {
    const root = freshRoot();

    applyTelegramTheme({ initData: "x", themeParams: { bg_color: "#101010" } }, root);

    expect(root.style.getPropertyValue("--background")).toBe("#101010");
    expect(root.style.getPropertyValue("--foreground")).toBe("");
  });
});
// [END: module]
