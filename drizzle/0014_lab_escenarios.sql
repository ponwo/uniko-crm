CREATE TABLE "lab_scenario" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"script" jsonb NOT NULL,
	"phone" text NOT NULL,
	"contact_name" text NOT NULL,
	"origin" text DEFAULT 'generado' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_test_run" ADD COLUMN "scenario_set" text;--> statement-breakpoint
ALTER TABLE "agent_test_run" ADD COLUMN "rubric_version" text;--> statement-breakpoint
ALTER TABLE "lab_scenario" ADD CONSTRAINT "lab_scenario_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lab_scenario_org_key_uq" ON "lab_scenario" USING btree ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_scenario_org_phone_uq" ON "lab_scenario" USING btree ("organization_id","phone");--> statement-breakpoint
CREATE INDEX "lab_scenario_org_idx" ON "lab_scenario" USING btree ("organization_id","position");