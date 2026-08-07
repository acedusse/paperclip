-- Bind a Telegram *user*, not just a chat.
--
-- Until now authority came from the chat alone: any member of a bound group chat could tap Approve
-- and have it attributed to whoever redeemed the link code. Recording the Telegram user id at
-- redemption lets the callback handler require that the tapper is that user.
--
-- No backfill is possible: nothing in the existing rows names a Telegram user. Live bindings
-- therefore keep a NULL here, and the decision path treats NULL as "cannot decide" — fail closed —
-- so those chats must re-link before they can approve again.
ALTER TABLE "telegram_chat_bindings" ADD COLUMN IF NOT EXISTS "telegram_user_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_chat_bindings_telegram_user_idx" ON "telegram_chat_bindings" ("telegram_user_id");
