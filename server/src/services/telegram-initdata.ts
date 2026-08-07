/**
 * FILE: server/src/services/telegram-initdata.ts
 * ABOUT: telegram-initdata.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - verify the signed initData a Telegram Mini App presents.
 */
// ==========================================
// [META: module]
// INTENT: Turn the opaque signed blob Telegram hands a webview into a trusted Telegram user id, or
//   into a refusal. This is the whole authentication boundary for the Mini App, so it is pure: no db,
//   no clock of its own, no I/O -- everything it decides is a function of its arguments.
// PSEUDOCODE: 1. Parse the query string; pull out and remove `hash`. 2. Rebuild the documented
//   data_check_string: remaining fields sorted by key, joined "k=v" with newlines. 3. secret =
//   HMAC(key "WebAppData", bot token); expected = HMAC(key secret, data_check_string). 4. Compare in
//   constant time. 5. Range-check auth_date. 6. Parse the user object.
// JSON_FLOW: {"file": "server/src/services/telegram-initdata.ts", "imports": "node:crypto", "exports": "verifyTelegramInitData, TelegramInitDataResult, MINIAPP_INITDATA_MAX_AGE_SECONDS"}
// ==========================================
// [START: module]
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A signature does not expire by itself, so a captured initData would otherwise be a permanent
 * credential. Five minutes is long enough for a slow webview boot and short enough that a leaked
 * blob is worthless by the time it is replayed.
 */
export const MINIAPP_INITDATA_MAX_AGE_SECONDS = 300;

export type TelegramInitDataResult =
  | {
      ok: true;
      telegramUserId: string;
      authDate: Date;
      user: { id: string; firstName: string | null; username: string | null };
    }
  | { ok: false; reason: "malformed" | "bad_signature" | "stale" | "no_user" };

function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
  } catch {
    return false;
  }
}

export function verifyTelegramInitData(input: {
  initData: string;
  botToken: string;
  now?: Date;
  maxAgeSeconds?: number;
}): TelegramInitDataResult {
  const now = input.now ?? new Date();
  const maxAge = input.maxAgeSeconds ?? MINIAPP_INITDATA_MAX_AGE_SECONDS;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(input.initData);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const presentedHash = params.get("hash");
  if (!presentedHash) return { ok: false, reason: "malformed" };
  params.delete("hash");

  // The documented data_check_string: every remaining field as "key=value", sorted by key,
  // newline-joined. Values are the already-decoded ones, not the percent-encoded originals.
  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  // Note the argument order: "WebAppData" is the KEY and the bot token is the MESSAGE. Reversing
  // these produces a stable-looking hash that verifies nothing.
  const secret = createHmac("sha256", "WebAppData").update(input.botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest("hex");
  if (!constantTimeHexEqual(presentedHash, expected)) return { ok: false, reason: "bad_signature" };

  const authDateRaw = params.get("auth_date");
  const authDateSeconds = Number(authDateRaw);
  if (!authDateRaw || !Number.isFinite(authDateSeconds)) return { ok: false, reason: "malformed" };
  const authDate = new Date(authDateSeconds * 1000);
  if ((now.getTime() - authDate.getTime()) / 1000 > maxAge) return { ok: false, reason: "stale" };

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, reason: "no_user" };
  let parsed: { id?: number | string; first_name?: string; username?: string };
  try {
    parsed = JSON.parse(userRaw);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (parsed.id === undefined || parsed.id === null) return { ok: false, reason: "no_user" };

  return {
    ok: true,
    telegramUserId: String(parsed.id),
    authDate,
    user: { id: String(parsed.id), firstName: parsed.first_name ?? null, username: parsed.username ?? null },
  };
}
// [END: module]
