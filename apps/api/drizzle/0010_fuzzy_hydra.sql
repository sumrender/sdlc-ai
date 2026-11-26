DROP INDEX "tasks_pull_request_number_key";--> statement-breakpoint
DROP INDEX "tasks_branch_name_key";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_project_pull_request_number_key" ON "tasks" USING btree ("project_id","pull_request_number") WHERE "tasks"."pull_request_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_project_branch_name_key" ON "tasks" USING btree ("project_id","branch_name") WHERE "tasks"."branch_name" is not null;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_slug_unique" UNIQUE("slug");