CREATE TABLE IF NOT EXISTS "bounded_agent_approvers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "grantor_user_id" text NOT NULL,
  "delegate_agent_id" text NOT NULL,
  "approval_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "max_band" text NOT NULL,
  "max_spend_cents" integer,
  "valid_from" timestamp with time zone DEFAULT now() NOT NULL,
  "valid_until" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_by_user_id" text,
  "updated_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bounded_agent_approvers_company_agent_idx" ON "bounded_agent_approvers" ("company_id","delegate_agent_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bounded_agent_approvers" ADD CONSTRAINT "bounded_agent_approvers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
