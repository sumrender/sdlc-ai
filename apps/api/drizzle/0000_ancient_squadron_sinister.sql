CREATE TYPE "public"."agent" AS ENUM('PLANNER', 'DEVELOPER', 'REVIEWER_SECURITY', 'REVIEWER_ARCHITECTURE', 'REVIEWER_QUALITY', 'REVIEWER_PERFORMANCE');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."artifact_type" AS ENUM('LOG', 'SCREENSHOT', 'VIDEO', 'TEST_REPORT', 'TRACE', 'DIFF');--> statement-breakpoint
CREATE TYPE "public"."deploy_target" AS ENUM('FE', 'BE');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('PENDING', 'BUILDING', 'LIVE', 'FAILED', 'TIMED_OUT');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('TASK_CREATED', 'TASK_STAGE_CHANGED', 'TASK_STATUS_CHANGED', 'AGENT_RUN_STARTED', 'AGENT_RUN_COMPLETED', 'AGENT_RUN_FAILED', 'QUESTION_CREATED', 'QUESTION_ANSWERED', 'CHECKS_STARTED', 'CHECKS_COMPLETED', 'PR_CREATED', 'TEST_RUN_STARTED', 'TEST_RUN_COMPLETED', 'REVIEW_COMPLETED', 'APPROVAL_REQUESTED', 'APPROVAL_DECIDED', 'MERGED', 'DEPLOYMENT_UPDATED', 'TASK_FAILED', 'TASK_RETRIED');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('CLOUDFLARE', 'RENDER');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('PENDING', 'ANSWERED');--> statement-breakpoint
CREATE TYPE "public"."reviewer" AS ENUM('REVIEWER_SECURITY', 'REVIEWER_ARCHITECTURE', 'REVIEWER_QUALITY', 'REVIEWER_PERFORMANCE');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('TODO', 'PLANNING', 'DEVELOPMENT', 'E2E', 'AGENT_REVIEW', 'HUMAN_REVIEW', 'STAGING');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('READY', 'RUNNING', 'WAITING', 'FAILED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('PASS', 'REJECT');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent" "agent" NOT NULL,
	"status" "run_status" DEFAULT 'QUEUED' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"opencode_session_id" text,
	"model" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"exit_code" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"test_run_id" uuid,
	"type" "artifact_type" NOT NULL,
	"name" text NOT NULL,
	"storage_path" text NOT NULL,
	"size_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"target" "deploy_target" NOT NULL,
	"provider" "provider" NOT NULL,
	"commit_sha" text NOT NULL,
	"provider_ref" text,
	"status" "deployment_status" DEFAULT 'PENDING' NOT NULL,
	"url" text,
	"error" text,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"type" "event_type" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"deploy_targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"text" text NOT NULL,
	"options" jsonb,
	"status" "question_status" DEFAULT 'PENDING' NOT NULL,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"reviewer" "reviewer" NOT NULL,
	"verdict" "verdict" NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"stage" "stage" DEFAULT 'TODO' NOT NULL,
	"status" "task_status" DEFAULT 'READY' NOT NULL,
	"plan" text,
	"issue_number" integer,
	"issue_url" text,
	"branch_name" text,
	"pull_request_number" integer,
	"pull_request_url" text,
	"merged_commit_sha" text,
	"e2e_reject_loop_used" boolean DEFAULT false NOT NULL,
	"pending_feedback" text,
	"error" text,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"command" text DEFAULT '' NOT NULL,
	"status" "run_status" DEFAULT 'QUEUED' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"exit_code" integer,
	"passed" integer,
	"failed" integer,
	"skipped" integer,
	"duration_ms" integer,
	"output" text,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_test_run_id_test_runs_id_fk" FOREIGN KEY ("test_run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;