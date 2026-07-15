DROP INDEX IF EXISTS "push_subscriptions_endpoint_unique_idx";
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "label" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_company_endpoint_unique_idx" ON "push_subscriptions" ("company_id","endpoint");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_delivery_prefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "min_band" text DEFAULT 'high' NOT NULL,
  "quiet_start" text,
  "quiet_end" text,
  "timezone" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_delivery_prefs_company_user_unique_idx" ON "push_delivery_prefs" ("company_id","user_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_delivery_prefs" ADD CONSTRAINT "push_delivery_prefs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
