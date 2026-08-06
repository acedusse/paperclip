/**
 * FILE: ui/src/telegram/TelegramGate.tsx
 * ABOUT: TelegramGate.tsx (telegram module).
 *
 * SECTIONS:
 *   [TAG: module] - hold the board back until the Mini App has a session, and theme it.
 */
// ==========================================
// [META: module]
// INTENT: Holds the board back from rendering until the Mini App has a bearer token, and paints
//   Telegram's theme onto the board's CSS variables. A separate module (rather than living inline in
//   main.tsx) so its three render branches -- pass-through, "Connecting...", and the failure message --
//   are unit-testable without executing main.tsx's side effects (service worker registration, root
//   creation).
// PSEUDOCODE: 1. Run useTelegramSession to get status/error. 2. On mount, if inside Telegram, call
//   ready()/expand(), apply the theme, and re-apply on themeChanged. 3. Outside Telegram (checked fresh
//   on every render, not cached), render children unconditionally. 4. Inside Telegram: render the
//   failure message when status is "failed", a "Connecting..." placeholder while not yet "ready", and
//   children once ready.
// JSON_FLOW: {"file": "ui/src/telegram/TelegramGate.tsx", "imports": "react, ./webapp, ./useTelegramSession", "exports": "TelegramGate"}
// ==========================================
// [START: module]
import { useEffect, type ReactNode } from "react";
import { getTelegramWebApp, applyTelegramTheme } from "./webapp";
import { useTelegramSession } from "./useTelegramSession";

export function TelegramGate({ children }: { children: ReactNode }) {
  const { status, error } = useTelegramSession();

  useEffect(() => {
    const app = getTelegramWebApp();
    if (!app) return;
    app.ready?.();
    app.expand?.();
    applyTelegramTheme(app, document.documentElement);
    app.onEvent?.("themeChanged", () => applyTelegramTheme(app, document.documentElement));
  }, []);

  // Outside Telegram this is a pass-through, so the ordinary board is untouched.
  if (!getTelegramWebApp()) return <>{children}</>;
  if (status === "failed") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }
  if (status !== "ready") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Connecting…
      </div>
    );
  }
  return <>{children}</>;
}
// [END: module]
