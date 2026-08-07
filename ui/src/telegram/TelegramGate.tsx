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
//   ready()/expand(), apply the theme (and hand colorScheme to ThemeContext so the provider agrees),
//   and re-apply on themeChanged. 3. Outside Telegram (checked fresh on every render, not cached),
//   render children unconditionally. 4. Inside Telegram: render the message when status is "failed" or
//   the terminal "expired", a "Connecting..." placeholder while not yet "ready", and children once ready.
// JSON_FLOW: {"file": "ui/src/telegram/TelegramGate.tsx", "imports": "react, ../context/ThemeContext, ./webapp, ./useTelegramSession", "exports": "TelegramGate"}
// ==========================================
// [START: module]
import { useEffect, type ReactNode } from "react";
import { useTheme } from "../context/ThemeContext";
import { getTelegramWebApp, applyTelegramTheme } from "./webapp";
import { useTelegramSession } from "./useTelegramSession";

export function TelegramGate({ children }: { children: ReactNode }) {
  const { status, error } = useTelegramSession();
  const { setTheme } = useTheme();

  useEffect(() => {
    const app = getTelegramWebApp();
    if (!app) return;
    app.ready?.();
    app.expand?.();
    // applyTelegramTheme puts the class on the document itself, but ThemeProvider owns that class and
    // re-applies its own state on mount (its effect runs after this child's). Telling the provider what
    // Telegram chose is what makes the choice stick rather than being overwritten a tick later.
    const paint = () => {
      applyTelegramTheme(app, document.documentElement);
      if (app.colorScheme) setTheme(app.colorScheme);
    };
    paint();
    app.onEvent?.("themeChanged", paint);
  }, [setTheme]);

  // Outside Telegram this is a pass-through, so the ordinary board is untouched.
  if (!getTelegramWebApp()) return <>{children}</>;
  // "expired" is terminal in the same way "failed" is -- the difference is only in the message, which
  // the hook already wrote.
  if (status === "failed" || status === "expired") {
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
