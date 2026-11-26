import { defineProjects } from "./packages/shared/src/config.js";

// Multi-project configuration (the only source of project behavior).
// Host secrets & infrastructure (DATABASE_URL, tokens, SANDBOX_IMAGE,
// MAX_GLOBAL_CONCURRENT_TASKS) stay in .env.
export default defineProjects([
  {
    slug: "meme",
    name: "Meme Studio",
    version: 2,
    repository: { owner: "sumrender", repo: "meme", defaultBranch: "main" },
    root: {
      setup: ["npm ci"],
      checks: [],
    },
    stacks: {
      frontend: {
        dir: "fe",
        paths: ["fe/**"],
        setup: ["npm ci --prefix fe"],
        checks: ["npm run build --prefix fe"],
        unitTests: { command: "npx ng test --watch=false --browsers=ChromeHeadless", cwd: "fe", env: {}, optional: true },
        integrations: [{ name: "Playwright E2E", notes: "npm run test:e2e in fe; E2E_START_SERVER boots ng serve" }],
      },
      backend: {
        dir: "be",
        paths: ["be/**"],
        setup: ["dotnet restore be/Backend.csproj"],
        checks: ["dotnet build be/Backend.csproj --no-restore"],
        unitTests: { command: "dotnet test be/Tests/Backend.Tests.csproj --no-build", cwd: ".", env: {}, optional: true },
        integrations: [{ name: "PostgreSQL + EF Core", notes: "Code-first migrations; connection via be/.env" }],
      },
    },
    e2e: {
      command: "npm run test:e2e",
      cwd: "fe",
      testDir: "e2e",
      env: { E2E_START_SERVER: "true" },
      artifacts: ["fe/playwright-report", "fe/test-results"],
      optional: false,
    },
    deploy: [
      { target: "FE", provider: "CLOUDFLARE", pathPrefix: "fe/", url: null },
      { target: "BE", provider: "RENDER", pathPrefix: "be/", url: null },
    ],
  },
  {
    slug: "sdlc-ai",
    name: "SDLC Control Plane",
    version: 2,
    repository: { owner: "sumrender", repo: "sdlc-ai", defaultBranch: "main" },
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
            notes: "Issues, branches, PRs and merges through the per-project GitHub service.",
          },
          {
            name: "Docker sandbox + OpenCode Zen",
            notes: "Task containers built by sandbox/build.mjs; agents run inside via OpenCode.",
          },
        ],
      },
    },
    e2e: null,
    deploy: [],
  },
]);
