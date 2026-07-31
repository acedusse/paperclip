CREATE TABLE IF NOT EXISTS "stakeholder_shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "token" text NOT NULL,
  "label" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "show_goal_progress" boolean DEFAULT false NOT NULL,
  "show_shipped_work" boolean DEFAULT false NOT NULL,
  "show_narrative" boolean DEFAULT false NOT NULL,
  "show_activity_timeline" boolean DEFAULT false NOT NULL,
  "expires_at" timestamp with time zone,
  "created_by_user_id" text,
  "revoked_at" timestamp with time zone,
  "rotated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stakeholder_shares_token_idx" ON "stakeholder_shares" ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_shares_company_created_idx" ON "stakeholder_shares" ("company_id","created_at");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_shares" ADD CONSTRAINT "stakeholder_shares_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
