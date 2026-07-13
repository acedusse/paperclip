CREATE TABLE IF NOT EXISTS "run_changesets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "heartbeat_run_id" uuid NOT NULL,
  "base_ref" text,
  "head_ref" text,
  "files" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "summary_stats" jsonb NOT NULL,
  "warning" text,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "run_changesets_heartbeat_run_id_unique" UNIQUE("heartbeat_run_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_risk" (
  "approval_id" uuid PRIMARY KEY NOT NULL,
  "company_id" uuid NOT NULL,
  "score" integer NOT NULL,
  "band" text NOT NULL,
  "reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_changesets" ADD CONSTRAINT "run_changesets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_changesets" ADD CONSTRAINT "run_changesets_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_risk" ADD CONSTRAINT "approval_risk_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_risk" ADD CONSTRAINT "approval_risk_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
