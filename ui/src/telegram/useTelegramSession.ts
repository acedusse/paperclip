/**
 * FILE: ui/src/telegram/useTelegramSession.ts
 * ABOUT: useTelegramSession.ts (telegram module).
 *
 * SECTIONS:
 *   [TAG: module] - exchange Telegram's initData for a board bearer token.
 */
// ==========================================
// [META: module]
// INTENT: Get the Mini App authenticated before the board renders, and say so honestly when that
//   session ends. The token is held in memory only -- persisting it would outlive the webview for no
//   benefit. Also the single place that knows how to attach the bearer to a request, so every
//   fetch-based module (client.ts, health.ts, auth.ts) shares one implementation instead of three
//   copies. There is no silent renewal: Telegram's initData has a fixed auth_date the server rejects
//   after five minutes and cannot be re-sourced while the webview is open, so a 12-hour session that
//   expires mid-visit is terminal and the operator must reopen from Telegram.
// PSEUDOCODE: 1. Read companyId from ?c= and initData from the WebApp object. 2. POST them for a
//   token. 3. Stash the token where fetch-based modules can read and attach it. 4. Expose status for
//   the shell to render. 5. On a 401 from a bearer-carrying request, callers mark the session expired;
//   subscribers flip the shell to a terminal "reopen from Telegram" state.
// JSON_FLOW: {"file": "ui/src/telegram/useTelegramSession.ts", "imports": "react, ./webapp", "exports": "useTelegramSession, getTelegramBearer, clearTelegramBearer, applyTelegramAuthHeader, markTelegramSessionExpired, isTelegramSessionExpired, subscribeTelegramSessionExpiry, resetTelegramSessionExpiry"}
// ==========================================
// [START: module]
import { useEffect, useState } from "react";
import { getTelegramWebApp } from "./webapp";

let bearer: string | null = null;
// The companyId the current bearer (or the most recent successful mint) was bound to. Kept separately
// from `bearer` -- clearing a dead token on a 401 must not lose track of which company to re-mint for,
// and by the time a background request 401s the page's URL may no longer carry `?c=` (only the Mini
// App's fixed entry route does).
let boundCompanyId: string | null = null;

/** Read by every fetch-based API module on every request. Null outside Telegram. */
export function getTelegramBearer(): string | null {
  return bearer;
}

/** Called on a 401 so the next request re-mints rather than looping on a dead token. */
export function clearTelegramBearer(): void {
  bearer = null;
}

/**
 * Attach the Telegram bearer to a request's headers when one is held. A no-op outside Telegram (and
 * before the first successful mint), where getTelegramBearer() is always null -- so every caller stays
 * transparent for the ordinary board without its own guard. Never overwrites an Authorization header a
 * caller already set.
 */
export function applyTelegramAuthHeader(headers: Headers): void {
  const token = getTelegramBearer();
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
}

/**
 * Set once a bearer-carrying request has come back 401 -- the session is over and cannot be renewed
 * from inside the webview (see markTelegramSessionExpired). Module-level rather than React state
 * because the 401 is observed by client.ts, which is not a component.
 */
let expired = false;
const expiryListeners = new Set<() => void>();

/**
 * Called by a fetch-based API module when a request that carried the bearer comes back 401 -- the
 * session expired or its binding was revoked.
 *
 * There is deliberately no recovery attempt here. Re-minting needs a fresh `initData`, and Telegram
 * gives the webview exactly one blob at launch with a fixed `auth_date`; the server rejects anything
 * older than five minutes, while the session lasts twelve hours. A re-mint from the held blob can
 * therefore only succeed inside the first five minutes of the webview's life — never the case it would
 * exist for. Telegram exposes no API to re-source `initData` while the Mini App is open, so the honest
 * outcome is a terminal state the operator can act on: reopen the Mini App from Telegram.
 */
export function markTelegramSessionExpired(): void {
  bearer = null;
  expired = true;
  for (const listener of expiryListeners) listener();
}

export function isTelegramSessionExpired(): boolean {
  return expired;
}

/** Subscribe to the terminal expiry above. Returns an unsubscribe function. */
export function subscribeTelegramSessionExpiry(listener: () => void): () => void {
  expiryListeners.add(listener);
  return () => {
    expiryListeners.delete(listener);
  };
}

/** Test-only: forget that a session ever expired, so each test starts from a live module. */
export function resetTelegramSessionExpiry(): void {
  expired = false;
}

type MintOutcome = { ok: true; token: string } | { ok: false; status: number | null };

async function mintSession(companyId: string, initData: string): Promise<MintOutcome> {
  try {
    const res = await fetch("/api/telegram/miniapp/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId, initData }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const body = (await res.json()) as { token: string };
    bearer = body.token;
    boundCompanyId = companyId;
    return { ok: true, token: body.token };
  } catch {
    return { ok: false, status: null };
  }
}

export type TelegramSessionStatus = "idle" | "authenticating" | "ready" | "failed" | "expired";

export const TELEGRAM_SESSION_EXPIRED_MESSAGE =
  "Your Paperclip session has expired. Close this window and reopen Paperclip from Telegram.";

export function useTelegramSession(): { status: TelegramSessionStatus; error: string | null } {
  const [status, setStatus] = useState<TelegramSessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // A session that dies mid-visit is terminal, so it outranks whatever the bootstrap last reported.
  useEffect(() => {
    const onExpired = () => {
      setStatus("expired");
      setError(TELEGRAM_SESSION_EXPIRED_MESSAGE);
    };
    if (isTelegramSessionExpired()) onExpired();
    return subscribeTelegramSessionExpiry(onExpired);
  }, []);

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
      const result = await mintSession(companyId, app.initData);
      // Expiry is terminal: never report "ready" over it, even if a mint that was already in flight
      // when the 401 landed comes back successful.
      if (cancelled || isTelegramSessionExpired()) return;
      if (!result.ok) {
        setStatus("failed");
        setError(
          result.status === 401
            ? "This Telegram account is not linked to Paperclip. Link it from the board, then reopen."
            : result.status === null
              ? "Could not reach Paperclip."
              : "Could not start a Paperclip session.",
        );
        return;
      }
      setStatus("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { status, error };
}
// [END: module]
