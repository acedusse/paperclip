CREATE TABLE IF NOT EXISTS "auto_approve_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "approval_type" text NOT NULL,
  "max_band" text NOT NULL,
  "max_spend_cents" integer DEFAULT 0 NOT NULL,
  "require_no_secrets" boolean DEFAULT true NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" text,
  "updated_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_approve_policies_company_active_idx" ON "auto_approve_policies" ("company_id","is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auto_approve_policies_company_agent_type_active_unique_idx" ON "auto_approve_policies" ("company_id","agent_id","approval_type","is_active");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_approve_policies" ADD CONSTRAINT "auto_approve_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_approve_policies" ADD CONSTRAINT "auto_approve_policies_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
