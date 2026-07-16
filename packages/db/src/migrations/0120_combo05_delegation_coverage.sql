CREATE TABLE IF NOT EXISTS "delegation_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "grantor_user_id" text NOT NULL,
  "delegate_user_id" text NOT NULL,
  "approval_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "max_band" text NOT NULL,
  "max_spend_cents" integer,
  "valid_from" timestamp with time zone DEFAULT now() NOT NULL,
  "valid_until" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "source" text DEFAULT 'manual' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delegation_grants_company_delegate_idx" ON "delegation_grants" ("company_id","delegate_user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_coverage_config" (
  "company_id" uuid PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "backup_user_id" text,
  "sla_critical_minutes" integer DEFAULT 60 NOT NULL,
  "sla_high_minutes" integer DEFAULT 240 NOT NULL,
  "sla_medium_minutes" integer DEFAULT 1440 NOT NULL,
  "sla_low_minutes" integer DEFAULT 4320 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_coverage_escalations" (
  "approval_id" uuid PRIMARY KEY NOT NULL,
  "company_id" uuid NOT NULL,
  "backup_user_id" text NOT NULL,
  "escalated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delegation_grants" ADD CONSTRAINT "delegation_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_coverage_config" ADD CONSTRAINT "company_coverage_config_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_coverage_escalations" ADD CONSTRAINT "approval_coverage_escalations_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_coverage_escalations" ADD CONSTRAINT "approval_coverage_escalations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
