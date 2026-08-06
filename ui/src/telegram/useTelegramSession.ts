/**
 * FILE: ui/src/telegram/useTelegramSession.ts
 * ABOUT: useTelegramSession.ts (telegram module).
 *
 * SECTIONS:
 *   [TAG: module] - exchange Telegram's initData for a board bearer token.
 */
// ==========================================
// [META: module]
// INTENT: Get the Mini App authenticated before the board renders, and keep it that way. The token is
//   held in memory only -- persisting it would outlive the webview for no benefit, since initData can
//   always mint another.
// PSEUDOCODE: 1. Read companyId from ?c= and initData from the WebApp object. 2. POST them for a
//   token. 3. Stash it where the API client can read it. 4. Expose status for the shell to render.
// JSON_FLOW: {"file": "ui/src/telegram/useTelegramSession.ts", "imports": "react, ./webapp", "exports": "useTelegramSession, getTelegramBearer, clearTelegramBearer"}
// ==========================================
// [START: module]
import { useEffect, useState } from "react";
import { getTelegramWebApp } from "./webapp";

let bearer: string | null = null;

/** Read by the API client on every request. Null outside Telegram. */
export function getTelegramBearer(): string | null {
  return bearer;
}

/** Called on a 401 so the next render re-mints rather than looping on a dead token. */
export function clearTelegramBearer(): void {
  bearer = null;
}

export type TelegramSessionStatus = "idle" | "authenticating" | "ready" | "failed";

export function useTelegramSession(): { status: TelegramSessionStatus; error: string | null } {
  const [status, setStatus] = useState<TelegramSessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const app = getTelegramWebApp();
    if (!app) return;

    const companyId = new URLSearchParams(window.location.search).get("c");
    if (!companyId) {
      setStatus("failed");
      setError("This link is missing its company. Open Paperclip from the bot's menu button.");
      return;
    }

    let cancelled = false;
    setStatus("authenticating");
    void (async () => {
      try {
        const res = await fetch("/api/telegram/miniapp/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ companyId, initData: app.initData }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setStatus("failed");
          setError(
            res.status === 401
              ? "This Telegram account is not linked to Paperclip. Link it from the board, then reopen."
              : "Could not start a Paperclip session.",
          );
          return;
        }
        const body = (await res.json()) as { token: string };
        bearer = body.token;
        setStatus("ready");
      } catch {
        if (cancelled) return;
        setStatus("failed");
        setError("Could not reach Paperclip.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { status, error };
}
// [END: module]
