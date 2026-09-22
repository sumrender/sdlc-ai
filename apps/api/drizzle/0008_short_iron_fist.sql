-- Human moderation of agent Reviews: per-review Accept/Reject with comment plus
-- curated verdict/findings (original agent output snapshotted on first edit).
-- Anyone opening the Task sees the human decision; Send-back ships the curated
-- findings to the Developer.
CREATE TYPE "public"."human_review_decision" AS ENUM('ACCEPTED', 'REJECTED');--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'REVIEW_ACCEPTED';--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'REVIEW_REJECTED';--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'REVIEW_EDITED';--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'REVIEW_SENT_BACK';--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "human_decision" "human_review_decision";--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "human_comment" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "human_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "human_edited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "original_verdict" "verdict";--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "original_findings" jsonb;
