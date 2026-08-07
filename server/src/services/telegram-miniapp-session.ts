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
//   initData. 3. Resolve a live binding for (company, telegram user), refusing when two live bindings
//   name different Paperclip users. 4. Mint a random token, store only its sha256. 5. resolve() looks up
//   by hash, rejecting revoked and expired rows and requiring the bot to still be enabled.
// JSON_FLOW: {"file": "server/src/services/telegram-miniapp-session.ts", "imports": "node:crypto, drizzle-orm, @paperclipai/db, ./telegram-initdata.js", "exports": "telegramMiniappSessionService, MINIAPP_SESSION_TTL_HOURS, TelegramMiniappMintResult"}
// ==========================================
// [START: module]
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import {
  telegramBotConfigs,
  telegramChatBindings,
  telegramMiniappSessions,
  type Db,
  type TelegramMiniappSessionRow,
} from "@paperclipai/db";
import { verifyTelegramInitData } from "./telegram-initdata.js";

/**
 * Short, because this is the board API as that user and the only thing standing behind it is a token in
 * a webview's memory. There is no silent renewal: Telegram's `initData` carries a fixed `auth_date` that
 * goes stale after five minutes and cannot be re-sourced while the webview is open, so an expired
 * session terminates and the operator reopens the Mini App from Telegram (which issues fresh initData).
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
  | {
      ok: false;
      reason: "no_bot" | "bad_signature" | "stale" | "malformed" | "not_bound" | "ambiguous_binding";
    };

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

      // (companyId, telegramUserId) is deliberately NOT unique -- the live-binding unique index is
      // (companyId, chatId) -- so one Telegram account that redeemed codes issued by two different
      // board users in the same company has two live bindings with two different Paperclip identities.
      // Fetch every match rather than trusting the row Postgres happens to return first.
      const bindings = await db
        .select()
        .from(telegramChatBindings)
        .where(
          and(
            eq(telegramChatBindings.companyId, input.companyId),
            eq(telegramChatBindings.telegramUserId, verified.telegramUserId),
            isNull(telegramChatBindings.revokedAt),
            isNotNull(telegramChatBindings.linkedAt),
          ),
        )
        // Same user, several chats is unambiguous about *who* but not about which binding row the
        // session hangs off -- and that row is what a later revocation keys on. Order so the session
        // always attaches to the most recently linked chat rather than to whatever the planner emits.
        .orderBy(desc(telegramChatBindings.linkedAt), desc(telegramChatBindings.id));
      // A pre-0125 binding has a null telegram_user_id and simply does not match here -- the same
      // fail-closed outcome the decision path reaches, by the same mechanism rather than a second rule.
      const binding = bindings[0];
      if (!binding) return { ok: false, reason: "not_bound" };
      // The decision path never faces this: it resolves by (company, chat), which *is* unique, so the
      // chat the tap came from names the identity. A Mini App request carries no chat, so when the
      // candidates disagree about who the session is there is nothing left to disambiguate with.
      // Picking the newest would be deterministic but would still silently choose one operator's
      // identity for an action the audit trail then attributes to them; an auth path that cannot
      // establish identity must refuse. The operator's fix is to unlink the stale chat from the board.
      if (bindings.some((row) => row.userId !== binding.userId)) {
        return { ok: false, reason: "ambiguous_binding" };
      }

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
      // The inner join is the point, not an optimisation: a session may only resolve while the company
      // still has an *enabled* bot. Without it, `enabled: false` (or a deleted config) stops new mints
      // while every already-minted session keeps working for the rest of its TTL -- so the board's
      // "turn the bot off" switch would silently mean "turn it off for new sessions only".
      const [row] = await db
        .select({ session: telegramMiniappSessions })
        .from(telegramMiniappSessions)
        .innerJoin(
          telegramBotConfigs,
          and(
            eq(telegramBotConfigs.companyId, telegramMiniappSessions.companyId),
            eq(telegramBotConfigs.enabled, true),
          ),
        )
        .where(
          and(
            eq(telegramMiniappSessions.tokenHash, hashToken(token)),
            isNull(telegramMiniappSessions.revokedAt),
            gt(telegramMiniappSessions.expiresAt, at),
          ),
        );
      return row?.session ?? null;
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
