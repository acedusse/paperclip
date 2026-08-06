-- Short-lived board sessions minted from a verified Telegram Mini App initData.
--
-- The token is returned to the client once and stored only as a sha256 hash, the same way
-- agent_api_keys are held. binding_id is kept so revoking a chat binding can revoke every session
-- it produced -- the board's "unlink chat" control must stay a real kill switch.
CREATE TABLE IF NOT EXISTS "telegram_miniapp_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "binding_id" uuid,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_miniapp_sessions_token_hash_idx" ON "telegram_miniapp_sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_miniapp_sessions_binding_idx" ON "telegram_miniapp_sessions" ("binding_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "telegram_miniapp_sessions" ADD CONSTRAINT "telegram_miniapp_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "telegram_miniapp_sessions" ADD CONSTRAINT "telegram_miniapp_sessions_binding_id_telegram_chat_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."telegram_chat_bindings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
