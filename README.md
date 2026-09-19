# sdlc-ai

An AI-native SDLC control plane: a Task moves through seven fixed Stages (TODO, PLANNING,
DEVELOPMENT, E2E, AGENT REVIEW, HUMAN REVIEW, STAGING) on a live Kanban. OpenCode agents run
in Docker Sandboxes, work lands as a GitHub branch and PR, the Project's own Playwright
suite runs, four Reviewer agents deliver Verdicts, and only a human Approval opens the Gate
into STAGING. Vocabulary is defined in [`CONTEXT.md`](CONTEXT.md); decisions in
[`docs/adr/`](docs/adr).

## Layout

| Package | What |
| --- | --- |
| `apps/web` | TanStack Start web app on **:3000** (Kanban, Task detail, Settings) |
| `apps/api` | Hono + Drizzle API on **:4000**; the workflow engine, agents, integrations |
| `packages/shared` | Domain unions, zod schemas, `API_PATHS`, Project Manifest schema |
| `sandbox/` | Runtime image for agent Sandboxes and its smoke test |

## Quick start

Prerequisites: Node 22+, pnpm 9, Docker Desktop.

```sh
pnpm install
cp .env.example .env        # fill in secrets, or set SDLC_FAKES=true
pnpm dev:local
```

`pnpm dev:local` starts Postgres on **:5959**, runs migrations, seeds one Project and Tasks
in every Stage and Status (with Agent Runs, a Question, Test Runs, Reviews, an Approval,
Deployments, Artifacts, and Events), then starts the web app and the API.

With `SDLC_FAKES=true` the API replaces Docker, GitHub, and the deploy providers with
scripted in-memory fakes so the whole pipeline can be driven without secrets. On boot the
API resumes every open Task (with fakes, seeded RUNNING Tasks finish in seconds); set
`SDLC_RESUME_ON_START=false` to keep the seeded board exactly as seeded while building
the web app.

## Real runs

```sh
pnpm sandbox:build                 # build sdlc-ai-sandbox:local
ANTHROPIC_API_KEY=... pnpm sandbox:smoke   # verify the image once per change
```

Then set `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, and the Render / Cloudflare variables in
`.env`, set `SDLC_FAKES=false`, and `pnpm dev`.

## Scripts

| Command | What |
| --- | --- |
| `pnpm dev` | web + API in watch mode |
| `pnpm typecheck` | all packages |
| `pnpm db:up` / `db:migrate` / `db:seed` | Postgres lifecycle |
| `pnpm db:generate` | regenerate Drizzle migrations after a schema change |

## API

All paths are in `API_PATHS` (`packages/shared/src/api.ts`). SSE at `GET /events?taskId=`
streams persisted Events plus ephemeral `AGENT_OUTPUT` lines.
