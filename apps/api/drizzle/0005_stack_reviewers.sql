-- Stack reviewers replace the topical reviewers. Old enum values are kept so
-- historical rows stay valid; new verdicts use REVIEWER_FRONTEND/BACKEND.
--> statement-breakpoint
ALTER TYPE "reviewer" RENAME TO "reviewer_old";
--> statement-breakpoint
CREATE TYPE "reviewer" AS ENUM('REVIEWER_SECURITY', 'REVIEWER_ARCHITECTURE', 'REVIEWER_QUALITY', 'REVIEWER_PERFORMANCE', 'REVIEWER_FRONTEND', 'REVIEWER_BACKEND');
--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "reviewer" TYPE "reviewer" USING "reviewer"::text::"reviewer";
--> statement-breakpoint
DROP TYPE "reviewer_old";
--> statement-breakpoint
ALTER TYPE "agent" RENAME TO "agent_old";
--> statement-breakpoint
CREATE TYPE "agent" AS ENUM('PLANNER', 'DEVELOPER', 'E2E_TEST_WRITER', 'REVIEWER_SECURITY', 'REVIEWER_ARCHITECTURE', 'REVIEWER_QUALITY', 'REVIEWER_PERFORMANCE', 'REVIEWER_FRONTEND', 'REVIEWER_BACKEND');
--> statement-breakpoint
ALTER TABLE "agent_runs" ALTER COLUMN "agent" TYPE "agent" USING "agent"::text::"agent";
--> statement-breakpoint
DROP TYPE "agent_old";
