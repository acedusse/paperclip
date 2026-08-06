CREATE TABLE IF NOT EXISTS "telegram_bot_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "bot_token" text NOT NULL,
  "bot_username" text,
  "webhook_secret" text NOT NULL,
  "public_base_url" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_bot_configs_company_unique_idx" ON "telegram_bot_configs" ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telegram_chat_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "chat_id" text,
  "chat_label" text,
  "link_code" text,
  "link_code_expires_at" timestamp with time zone,
  "linked_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_chat_bindings_company_chat_unique_idx" ON "telegram_chat_bindings" ("company_id","chat_id") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_chat_bindings_link_code_unique_idx" ON "telegram_chat_bindings" ("link_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_chat_bindings_company_idx" ON "telegram_chat_bindings" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_chat_bindings_chat_idx" ON "telegram_chat_bindings" ("chat_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "telegram_bot_configs" ADD CONSTRAINT "telegram_bot_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "telegram_chat_bindings" ADD CONSTRAINT "telegram_chat_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
