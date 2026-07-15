ALTER TABLE "companies" ADD COLUMN "predictive_breaker_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "breaker_horizon_minutes" integer;--> statement-breakpoint
CREATE TABLE "company_breaker_state" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"level" text DEFAULT 'normal' NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"last_burn_rate_cpm" double precision,
	"last_time_to_limit_m" double precision,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_breaker_state" ADD CONSTRAINT "company_breaker_state_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
