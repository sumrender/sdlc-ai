import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

// drizzle-kit never loads .env itself; mirror src/env.ts so db:generate /
// db:migrate pick up the repo-root .env when DATABASE_URL isn't exported.
for (const candidate of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../../.env")]) {
  if (fs.existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      // already loaded or unreadable; explicit env vars still work
    }
  }
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
