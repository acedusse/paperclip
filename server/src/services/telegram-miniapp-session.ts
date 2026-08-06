/**
 * FILE: server/src/services/telegram-miniapp-session.ts
 * ABOUT: telegram-miniapp-session.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - mint and resolve the bearer sessions a Telegram Mini App runs on.
 */
// ==========================================
// [META: module]
// INTENT: Trade a verified initData for a short-lived board session scoped to exactly one company.
//   This is a far larger grant than an inline button ever was -- a button decided one approval, this
//   is the board API as that user -- so the identity it rests on is re-derived here from the binding
//   and never taken from the request.
// PSEUDOCODE: 1. Load the company's enabled bot config; its token is the HMAC key. 2. Verify the
//   initData. 3. Resolve a live binding for (company, telegram user). 4. Mint a random token, store
//   only its sha256. 5. resolve() looks up by hash, rejecting revoked and expired rows.
// JSON_FLOW: {"file": "server/src/services/telegram-miniapp-session.ts", "imports": "node:crypto, drizzle-orm, @paperclipai/db, ./telegram-initdata.js", "exports": "telegramMiniappSessionService, MINIAPP_SESSION_TTL_HOURS, TelegramMiniappMintResult"}
// ==========================================
// [START: module]
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import {
  telegramBotConfigs,
  telegramChatBindings,
  telegramMiniappSessions,
  type Db,
  type TelegramMiniappSessionRow,
} from "@paperclipai/db";
import { verifyTelegramInitData } from "./telegram-initdata.js";

/**
 * Short, because the webview holds its initData for as long as it is open and can mint a replacement
 * silently on a 401 -- the operator never sees an expiry, so there is no reason to be generous.
 */
export const MINIAPP_SESSION_TTL_HOURS = 12;
const TOKEN_BYTES = 32;

export type TelegramMiniappMintResult =
  | {
      ok: true;
      token: string;
      expiresAt: Date;
      userId: string;
      companyId: string;
      user: { id: string; firstName: string | null; username: string | null };
    }
  | { ok: false; reason: "no_bot" | "bad_signature" | "stale" | "malformed" | "not_bound" };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function telegramMiniappSessionService(db: Db) {
  return {
    async mint(input: { companyId: string; initData: string; now?: Date }): Promise<TelegramMiniappMintResult> {
      const now = input.now ?? new Date();

      const [config] = await db
        .select()
        .from(telegramBotConfigs)
        .where(and(eq(telegramBotConfigs.companyId, input.companyId), eq(telegramBotConfigs.enabled, true)));
      if (!config) return { ok: false, reason: "no_bot" };

      const verified = verifyTelegramInitData({
        initData: input.initData,
        botToken: config.botToken,
        now,
      });
      if (!verified.ok) {
        // "no_user" is a malformed payload from our side of the boundary: correctly signed, but
        // carrying nothing we can act as.
        return { ok: false, reason: verified.reason === "no_user" ? "malformed" : verified.reason };
      }

      const [binding] = await db
        .select()
        .from(telegramChatBindings)
        .where(
          and(
            eq(telegramChatBindings.companyId, input.companyId),
            eq(telegramChatBindings.telegramUserId, verified.telegramUserId),
            isNull(telegramChatBindings.revokedAt),
            isNotNull(telegramChatBindings.linkedAt),
          ),
        );
      // A pre-0125 binding has a null telegram_user_id and simply does not match here -- the same
      // fail-closed outcome the decision path reaches, by the same mechanism rather than a second rule.
      if (!binding) return { ok: false, reason: "not_bound" };

      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const expiresAt = new Date(now.getTime() + MINIAPP_SESSION_TTL_HOURS * 3_600_000);
      await db.insert(telegramMiniappSessions).values({
        companyId: input.companyId,
        userId: binding.userId,
        bindingId: binding.id,
        tokenHash: hashToken(token),
        expiresAt,
      });

      return {
        ok: true,
        token,
        expiresAt,
        userId: binding.userId,
        companyId: input.companyId,
        user: verified.user,
      };
    },

    async resolve(token: string, now?: Date): Promise<TelegramMiniappSessionRow | null> {
      const at = now ?? new Date();
      const [row] = await db
        .select()
        .from(telegramMiniappSessions)
        .where(
          and(
            eq(telegramMiniappSessions.tokenHash, hashToken(token)),
            isNull(telegramMiniappSessions.revokedAt),
            gt(telegramMiniappSessions.expiresAt, at),
          ),
        );
      return row ?? null;
    },

    async touch(id: string): Promise<void> {
      await db
        .update(telegramMiniappSessions)
        .set({ lastUsedAt: new Date() })
        .where(eq(telegramMiniappSessions.id, id));
    },

    // Accepts an optional transaction handle so a caller (telegram-link.ts's revokeBinding) can run
    // this in the same transaction as the binding update it must be atomic with. Defaulting to the
    // outer `db` keeps this callable standalone too. Typed `any` to match this codebase's existing
    // dbOrTx convention (see document-annotations.ts, issue-references.ts) -- the transaction handle
    // drizzle hands a callback is not structurally identical to `Db`.
    async revokeForBinding(bindingId: string, dbOrTx: any = db): Promise<void> {
      await dbOrTx
        .update(telegramMiniappSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(telegramMiniappSessions.bindingId, bindingId), isNull(telegramMiniappSessions.revokedAt)));
    },
  };
}
// [END: module]
