ALTER TABLE "budget_policies" ALTER COLUMN "amount" TYPE bigint;
--> statement-breakpoint
ALTER TABLE "budget_incidents" ALTER COLUMN "amount_limit" TYPE bigint;
--> statement-breakpoint
ALTER TABLE "budget_incidents" ALTER COLUMN "amount_observed" TYPE bigint;
