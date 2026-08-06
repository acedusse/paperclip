/**
 * FILE: ui/src/telegram/webapp.ts
 * ABOUT: webapp.ts (telegram module).
 *
 * SECTIONS:
 *   [TAG: module] - the window.Telegram.WebApp adapter.
 */
// ==========================================
// [META: module]
// INTENT: One place that knows what Telegram injects, so nothing else in the UI reaches into a global
//   that may not exist. Detection, theme and expand all read through here.
// PSEUDOCODE: 1. Type the slice of the WebApp API we use. 2. getTelegramWebApp reads the global.
//   3. isTelegramWebApp is a boolean over it. 4. applyTelegramTheme maps themeParams onto our CSS vars.
// JSON_FLOW: {"file": "ui/src/telegram/webapp.ts", "imports": "none", "exports": "getTelegramWebApp, isTelegramWebApp, applyTelegramTheme, TelegramWebApp"}
// ==========================================
// [START: module]

/** Only the slice of the Mini App API this build uses. */
export type TelegramWebApp = {
  initData: string;
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string>;
  expand?: () => void;
  ready?: () => void;
  onEvent?: (event: string, handler: () => void) => void;
};

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  // An empty initData means the page was opened outside Telegram (or by something imitating it with
  // nothing to prove), and there is nothing we could authenticate with.
  return candidate && typeof candidate.initData === "string" && candidate.initData.length > 0
    ? candidate
    : null;
}

export function isTelegramWebApp(): boolean {
  return getTelegramWebApp() !== null;
}

/**
 * Telegram's themeParams are snake_case colour strings. Map the ones the board actually uses onto its
 * existing custom properties, and set the light/dark attribute from colorScheme, so the webview reads
 * as native rather than as a website in a box.
 */
export function applyTelegramTheme(app: TelegramWebApp, root: HTMLElement): void {
  const params = app.themeParams ?? {};
  const assign = (cssVar: string, key: string) => {
    const value = params[key];
    if (value) root.style.setProperty(cssVar, value);
  };
  assign("--background", "bg_color");
  assign("--foreground", "text_color");
  assign("--muted-foreground", "hint_color");
  assign("--primary", "button_color");
  assign("--primary-foreground", "button_text_color");
  if (app.colorScheme) root.setAttribute("data-theme", app.colorScheme);
}
// [END: module]
