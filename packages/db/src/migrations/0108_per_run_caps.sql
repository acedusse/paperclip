ALTER TABLE "companies" ADD COLUMN "max_run_wall_clock_ms" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "max_run_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "max_run_wall_clock_ms" integer;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "max_run_cost_cents" integer;
