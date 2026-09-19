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

// .env files commonly leave keys blank; treat "" as unset so defaults apply.
const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optional = () => z.preprocess(blankToUndefined, z.string().optional());
const withDefault = (value: string) => z.preprocess(blankToUndefined, z.string().default(value));
const flag = () => z.preprocess((v) => v === "true" || v === "1", z.boolean());

const EnvSchema = z.object({
  PORT: z.preprocess(blankToUndefined, z.coerce.number().int().default(4000)),
  DATABASE_URL: z.string().min(1),
  GITHUB_TOKEN: optional(),
  GITHUB_OWNER: withDefault("sumrender"),
  GITHUB_REPO: withDefault("meme"),
  GITHUB_DEFAULT_BRANCH: withDefault("main"),
  ANTHROPIC_API_KEY: optional(),
  MODEL_DEVELOPER: withDefault("claude-sonnet-5"),
  MODEL_FAST: withDefault("claude-haiku-4-5-20251001"),
  RENDER_API_KEY: optional(),
  RENDER_SERVICE_ID: optional(),
  CF_API_TOKEN: optional(),
  CF_ACCOUNT_ID: optional(),
  CF_WORKER_NAME: optional(),
  FE_ORIGIN: optional(),
  BE_ORIGIN: optional(),
  CONTROL_PLANE_URL: withDefault("http://localhost:3000"),
  SANDBOX_IMAGE: withDefault("sdlc-ai-sandbox:local"),
  DOCKER_BIN: withDefault("docker"),
  ARTIFACTS_DIR: withDefault("./artifacts"),
  // Replaces Docker, GitHub and deploy providers with scripted in-memory fakes.
  SDLC_FAKES: flag(),
  // Set to false to leave seeded Tasks untouched on boot (frontend work against seed data).
  SDLC_RESUME_ON_START: z.preprocess((v) => v !== "false" && v !== "0", z.boolean()),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;
