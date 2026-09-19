import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

for (const candidate of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../../.env")]) {
  if (fs.existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      // already loaded or unreadable; fall through to process.env
    }
  }
}

const optional = () => z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());
const flag = () => z.preprocess((v) => v === "true" || v === "1", z.boolean());

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  GITHUB_TOKEN: optional(),
  GITHUB_OWNER: z.string().default("sumrender"),
  GITHUB_REPO: z.string().default("meme"),
  GITHUB_DEFAULT_BRANCH: z.string().default("main"),
  ANTHROPIC_API_KEY: optional(),
  MODEL_DEVELOPER: z.string().default("claude-sonnet-5"),
  MODEL_FAST: z.string().default("claude-haiku-4-5-20251001"),
  RENDER_API_KEY: optional(),
  RENDER_SERVICE_ID: optional(),
  CF_API_TOKEN: optional(),
  CF_ACCOUNT_ID: optional(),
  CF_WORKER_NAME: optional(),
  FE_ORIGIN: optional(),
  BE_ORIGIN: optional(),
  CONTROL_PLANE_URL: z.string().default("http://localhost:3000"),
  SANDBOX_IMAGE: z.string().default("sdlc-ai-sandbox:local"),
  DOCKER_BIN: z.string().default("docker"),
  ARTIFACTS_DIR: z.string().default("./artifacts"),
  // Replaces Docker, GitHub and deploy providers with scripted in-memory fakes.
  SDLC_FAKES: flag(),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;
