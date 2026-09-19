ALTER TYPE "public"."agent" ADD VALUE 'E2E_TEST_WRITER' BEFORE 'REVIEWER_SECURITY';--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'E2E_COVERAGE_DECIDED';--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'PR_COMMENT_POSTED';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "e2e_coverage_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "e2e_generated_spec_path" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "e2e_report_comment_url" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "e2e_report_video_url" text;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "coverage_checked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "generated_spec_path" text;