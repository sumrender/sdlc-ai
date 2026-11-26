-- Config rev active when the task started (nullable: legacy rows unstamped).
ALTER TABLE "tasks" ADD COLUMN "config_hash" text;
