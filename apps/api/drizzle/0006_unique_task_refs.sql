-- One owner per PR / branch (partial unique indexes; NULLs never conflict).
-- Duplicates slipped in via PR adoption + force:true: both tasks then committed
-- to the same branch, commented on the same PR, and deleteBranch on merge
-- pulled the branch out from under the other. Detach older duplicates first
-- (keep the newest task's claim) so existing databases that already contain
-- the bug can take the indexes. A task that loses its claim can get a fresh
-- branch via retry-with-new-branch.
--> statement-breakpoint
UPDATE "tasks" SET "pull_request_number" = NULL, "pull_request_url" = NULL
WHERE "pull_request_number" IS NOT NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("pull_request_number") "id" FROM "tasks"
    WHERE "pull_request_number" IS NOT NULL
    ORDER BY "pull_request_number", "created_at" DESC
  );
--> statement-breakpoint
UPDATE "tasks" SET "branch_name" = NULL
WHERE "branch_name" IS NOT NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("branch_name") "id" FROM "tasks"
    WHERE "branch_name" IS NOT NULL
    ORDER BY "branch_name", "created_at" DESC
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_pull_request_number_key" ON "tasks" USING btree ("pull_request_number") WHERE "pull_request_number" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_branch_name_key" ON "tasks" USING btree ("branch_name") WHERE "branch_name" IS NOT NULL;
