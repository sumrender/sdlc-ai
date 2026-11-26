import { defineProject } from "./packages/shared/src/config.js";

// Single project config (the only source; the repo manifest is not read).
// Infra (DATABASE_URL, tokens, SANDBOX_IMAGE, origins) stays in .env.
export default defineProject({
  version: 2,
  repository: { owner: "sumrender", repo: "meme", defaultBranch: "main" },
  root: {
    setup: ["pnpm install"],
    checks: ["pnpm -r typecheck"],
  },
  stacks: {
    frontend: {
      dir: "apps/web",
      paths: ["apps/web/**"],
      setup: [],
      checks: ["pnpm --filter @sdlc-ai/web build"],
      unitTests: null,
      integrations: [
        {
          name: "Control-plane UI",
          notes: "Vite + React + TanStack Router/Query board, task detail, settings and fixture-mode pages served from apps/web.",
        },
      ],
    },
    backend: {
      dir: "apps/api",
      paths: ["apps/api/**"],
      setup: [],
      checks: ["pnpm --filter @sdlc-ai/api build"],
      unitTests: { command: "pnpm --filter @sdlc-ai/api test", cwd: ".", env: {}, optional: false },
      integrations: [
        {
          name: "PostgreSQL + Drizzle",
          notes: "Hono API with Drizzle ORM; migrations in apps/api/drizzle, seed via pnpm --filter @sdlc-ai/api db:seed.",
        },
        {
          name: "GitHub (Octokit)",
          notes: "Issues, branches, PRs, merges and manifest reads through the GitHub service.",
        },
        {
          name: "Docker sandbox + OpenCode Zen",
          notes: "Task containers built by sandbox/build.mjs; agents run inside via OpenCode. Deploy polling via CLOUDFLARE/RENDER providers.",
        },
      ],
    },
  },
  e2e: null,
  // Deploy prefixes must overlap a stack's paths or the target never triggers
  // (warned at load and in Settings). Origins stay in env (FE_ORIGIN/BE_ORIGIN).
  deploy: [
    { target: "FE", provider: "CLOUDFLARE", pathPrefix: "fe/", url: null },
    { target: "BE", provider: "RENDER", pathPrefix: "be/", url: null },
  ],
});
