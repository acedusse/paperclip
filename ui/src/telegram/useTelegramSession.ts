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
//   always mint another. Also the single place that knows how to attach the bearer to a request and how
//   to re-mint one after it expires, so every fetch-based module (client.ts, health.ts, auth.ts) shares
//   one implementation instead of three copies.
// PSEUDOCODE: 1. Read companyId from ?c= and initData from the WebApp object. 2. POST them for a
//   token, remembering the companyId a mint bound to. 3. Stash the token where fetch-based modules can
//   read and attach it. 4. Expose status for the shell to render. 5. On a 401, callers ask this module
//   to clear the dead token and re-mint from the still-held initData and remembered companyId.
// JSON_FLOW: {"file": "ui/src/telegram/useTelegramSession.ts", "imports": "react, ./webapp", "exports": "useTelegramSession, getTelegramBearer, clearTelegramBearer, applyTelegramAuthHeader, refreshTelegramBearer"}
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

/**
 * Called by a fetch-based API module when a request that carried the bearer comes back 401 -- the
 * 12-hour token expired mid-session. Clears the dead token and re-mints from the initData the webview
 * still holds (Telegram never invalidates initData while the Mini App stays open) against the companyId
 * the last successful mint bound to. Returns the fresh token so the caller can retry once, or null when
 * re-minting isn't possible -- outside Telegram, before any mint has ever succeeded, or because the
 * binding itself was revoked -- in which case the caller falls through to the original 401.
 */
export async function refreshTelegramBearer(): Promise<string | null> {
  clearTelegramBearer();
  const app = getTelegramWebApp();
  if (!app || !boundCompanyId) return null;
  const result = await mintSession(boundCompanyId, app.initData);
  return result.ok ? result.token : null;
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
      const result = await mintSession(companyId, app.initData);
      if (cancelled) return;
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
