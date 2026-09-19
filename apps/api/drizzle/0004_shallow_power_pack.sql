ALTER TABLE "projects" ALTER COLUMN "reuse_sandbox" SET DEFAULT true;
--> statement-breakpoint
UPDATE "projects" SET "reuse_sandbox" = true;