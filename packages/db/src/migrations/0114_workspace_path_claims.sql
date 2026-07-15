CREATE TABLE "workspace_path_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"execution_workspace_id" uuid NOT NULL,
	"heartbeat_run_id" uuid,
	"agent_id" uuid,
	"path" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_path_claims" ADD CONSTRAINT "workspace_path_claims_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_path_claims" ADD CONSTRAINT "workspace_path_claims_execution_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_path_claims" ADD CONSTRAINT "workspace_path_claims_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_path_claims" ADD CONSTRAINT "workspace_path_claims_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_path_claims_company_workspace_status_idx" ON "workspace_path_claims" USING btree ("company_id","execution_workspace_id","status");--> statement-breakpoint
CREATE INDEX "workspace_path_claims_heartbeat_run_idx" ON "workspace_path_claims" USING btree ("heartbeat_run_id");--> statement-breakpoint
CREATE INDEX "workspace_path_claims_company_expires_idx" ON "workspace_path_claims" USING btree ("company_id","expires_at");
