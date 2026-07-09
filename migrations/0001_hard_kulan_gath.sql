CREATE TABLE "automation_node_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"automacao_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_type" text NOT NULL,
	"contact_id" uuid,
	"status" text NOT NULL,
	"error_message" text,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_automation_node_logs_automacao" ON "automation_node_logs" USING btree ("automacao_id");--> statement-breakpoint
CREATE INDEX "idx_automation_node_logs_workspace" ON "automation_node_logs" USING btree ("workspace_id");