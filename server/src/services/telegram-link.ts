/**
 * FILE: server/src/services/telegram-link.ts
 * ABOUT: telegram-link.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - one-time link codes binding a Telegram chat to one authorised Paperclip user.
 */
// ==========================================
// [META: module]
// INTENT: Own the identity half of the Telegram channel. A chat may only ever act as the user who was
//   issued the code it redeemed; codes are single-use and time-boxed, and revocation is immediate.
// PSEUDOCODE: 1. createLinkCode inserts an unredeemed row holding a random code + expiry.
//   2. redeemLinkCode finds a live code, revokes any prior live binding for that chat, then stamps
//   chat_id/linked_at and clears the code so it cannot be replayed.
//   3. resolveBinding returns only linked, unrevoked rows. 4. revokeBinding/revokeAllBindings/listBindings
//   for the board UI. Every path that revokes a binding -- unlink, disconnect-bot, and the supersede
//   inside redeemLinkCode -- also revokes the Mini App sessions that binding minted, in one transaction.
// JSON_FLOW: {"file": "server/src/services/telegram-link.ts", "imports": "node:crypto, drizzle-orm, @paperclipai/db", "exports": "telegramLinkService, TelegramBinding, RedeemResult"}
// ==========================================
// [START: module]
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { telegramChatBindings, type Db, type TelegramChatBindingRow } from "@paperclipai/db";
import { telegramMiniappSessionService } from "./telegram-miniapp-session.js";

/** Codes are read off a phone screen and typed into a chat, so keep them short but unguessable. */
const CODE_BYTES = 12;
const DEFAULT_TTL_MINUTES = 60;

export type TelegramBinding = TelegramChatBindingRow;
export type RedeemResult =
  | { ok: true; binding: TelegramBinding }
  | { ok: false; reason: "unknown_code" | "expired" };

function newCode(): string {
  return randomBytes(CODE_BYTES).toString("base64url");
}

export function telegramLinkService(db: Db) {
  async function resolveBinding(
    input: { companyId: string; chatId: string },
    // Typed `any` to match this codebase's existing dbOrTx convention (see document-annotations.ts):
    // the handle drizzle hands a transaction callback is not structurally identical to `Db`.
    dbOrTx: any = db,
  ): Promise<TelegramBinding | null> {
    const [row] = await dbOrTx
      .select()
      .from(telegramChatBindings)
      .where(
        and(
          eq(telegramChatBindings.companyId, input.companyId),
          eq(telegramChatBindings.chatId, input.chatId),
          isNull(telegramChatBindings.revokedAt),
          isNotNull(telegramChatBindings.linkedAt),
        ),
      );
    return row ?? null;
  }

  const miniappSessions = telegramMiniappSessionService(db);

  return {
    resolveBinding,

    async createLinkCode(input: {
      companyId: string;
      userId: string;
      chatLabel?: string | null;
      ttlMinutes?: number;
      now?: Date;
    }): Promise<{ id: string; code: string; expiresAt: Date }> {
      const now = input.now ?? new Date();
      const expiresAt = new Date(now.getTime() + (input.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60_000);
      const code = newCode();
      const [row] = await db
        .insert(telegramChatBindings)
        .values({
          companyId: input.companyId,
          userId: input.userId,
          chatLabel: input.chatLabel ?? null,
          linkCode: code,
          linkCodeExpiresAt: expiresAt,
        })
        .returning();
      return { id: row!.id, code, expiresAt };
    },

    /**
     * Redeem a one-time code from a chat. `telegramUserId` is the Telegram account that sent the
     * `/start` — it becomes the only account allowed to act on this binding, which is what makes a
     * bound group chat safe.
     */
    async redeemLinkCode(input: {
      code: string;
      chatId: string;
      telegramUserId: string;
      now?: Date;
    }): Promise<RedeemResult> {
      const now = input.now ?? new Date();
      const [pending] = await db
        .select()
        .from(telegramChatBindings)
        .where(and(eq(telegramChatBindings.linkCode, input.code), isNull(telegramChatBindings.revokedAt)));
      if (!pending || pending.linkedAt) return { ok: false, reason: "unknown_code" };
      if (pending.linkCodeExpiresAt && pending.linkCodeExpiresAt.getTime() < now.getTime()) {
        return { ok: false, reason: "expired" };
      }

      // A chat speaks for one user at a time: redeeming a new code retires the previous binding
      // rather than silently adding a second identity for the same chat. Superseding is a revocation
      // like any other, so it must take the superseded binding's Mini App sessions down with it --
      // otherwise re-linking a chat to a different user leaves the old user's webview session live for
      // up to the full session TTL. Both writes plus the new binding's link commit together.
      return db.transaction(async (tx) => {
        const existing = await resolveBinding({ companyId: pending.companyId, chatId: input.chatId }, tx);
        if (existing) {
          await tx
            .update(telegramChatBindings)
            .set({ revokedAt: now })
            .where(eq(telegramChatBindings.id, existing.id));
          await miniappSessions.revokeForBinding(existing.id, tx);
        }

        const [linked] = await tx
          .update(telegramChatBindings)
          .set({
            chatId: input.chatId,
            telegramUserId: input.telegramUserId,
            linkedAt: now,
            linkCode: null,
            linkCodeExpiresAt: null,
          })
          .where(and(eq(telegramChatBindings.id, pending.id), isNull(telegramChatBindings.linkedAt)))
          .returning();
        if (!linked) return { ok: false, reason: "unknown_code" } as RedeemResult;
        return { ok: true, binding: linked } as RedeemResult;
      });
    },

    async revokeBinding(input: { companyId: string; id: string }): Promise<boolean> {
      // Both writes run in one transaction: unlinking a chat must also end every Mini App session it
      // produced, or the board's kill switch would only stop the buttons and leave the webview
      // holding a working board session. A crash between two unwrapped writes could leave exactly
      // that half-revoked state, so the binding update and the session revocation must commit -- or
      // fail -- together.
      return db.transaction(async (tx) => {
        const revoked = await tx
          .update(telegramChatBindings)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(telegramChatBindings.id, input.id),
              eq(telegramChatBindings.companyId, input.companyId),
              isNull(telegramChatBindings.revokedAt),
            ),
          )
          .returning();
        if (revoked.length === 0) return false;
        await miniappSessions.revokeForBinding(input.id, tx);
        return true;
      });
    },

    /**
     * Revoke every live binding for a company and, with them, every Mini App session those bindings
     * minted. This is what "Disconnect bot" means: an operator reaching for it because a phone was
     * stolen has to be cutting *all* access, not just the inline buttons. Accepts the caller's
     * transaction so the config delete and the revocations commit together.
     */
    async revokeAllBindings(input: { companyId: string }, dbOrTx: any = db): Promise<number> {
      const run = async (tx: any) => {
        const revoked = await tx
          .update(telegramChatBindings)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(telegramChatBindings.companyId, input.companyId),
              isNull(telegramChatBindings.revokedAt),
            ),
          )
          .returning({ id: telegramChatBindings.id });
        for (const row of revoked as { id: string }[]) {
          await miniappSessions.revokeForBinding(row.id, tx);
        }
        return (revoked as { id: string }[]).length;
      };
      return dbOrTx === db ? db.transaction(run) : run(dbOrTx);
    },

    async touchBinding(id: string): Promise<void> {
      await db.update(telegramChatBindings).set({ lastUsedAt: new Date() }).where(eq(telegramChatBindings.id, id));
    },

    listBindings(companyId: string): Promise<TelegramBinding[]> {
      return db
        .select()
        .from(telegramChatBindings)
        .where(
          and(
            eq(telegramChatBindings.companyId, companyId),
            isNull(telegramChatBindings.revokedAt),
            isNotNull(telegramChatBindings.linkedAt),
          ),
        )
        .orderBy(desc(telegramChatBindings.linkedAt));
    },
  };
}
// [END: module]
