ALTER TABLE "companies" ADD COLUMN "schedule_windows" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "schedule_timezone" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "manual_cap_override" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "manual_cap_override_expires_at" timestamp with time zone;
