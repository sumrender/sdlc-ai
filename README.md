# AI powered SDLC

## 🎥 Demo

[▶️ **Watch the AI-powered SDLC demo**](https://drive.google.com/file/d/1M68KbXx7560ukndh5eSSoWD7BRFZ_DbY/view)

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

`pnpm dev:local` starts Postgres on **:5959** and then the web app and the API
against an empty database (migrations run automatically on API boot). To populate a
demo board, run `pnpm db:seed` explicitly.

With `SDLC_FAKES=true` the API replaces Docker, GitHub, and the deploy providers with
scripted in-memory fakes so the whole pipeline can be driven without secrets. On boot the
API resumes every open Task (with fakes, seeded RUNNING Tasks finish in seconds); set
`SDLC_RESUME_ON_START=false` to keep the seeded board exactly as seeded while building
the web app.

## Real runs

```sh
pnpm sandbox:build                 # build sdlc-ai-sandbox:local (auto-picks Dockerfile.windows on Windows)
OPENCODE_API_KEY=... pnpm sandbox:smoke   # verify the image once per change
```

Then set `GITHUB_TOKEN`, `OPENCODE_API_KEY`, and the Render / Cloudflare variables in
`.env`, set `SDLC_FAKES=false`, and `pnpm dev`.

## Project config vs infrastructure

Multiple projects are declared in `sdlc.config.ts` via `defineProjects([...])`
(slug, repository, setup/checks, stacks, e2e, deploy targets, provider IDs,
optional per-project models/sandbox image) — versioned, with each project's
`rev <hash>` shown in Settings. Secrets and host infrastructure stay in `.env`
(`DATABASE_URL`, `GITHUB_TOKEN`, `OPENCODE_API_KEY`, `MAX_GLOBAL_CONCURRENT_TASKS`,
`SANDBOX_IMAGE`, …); see `.env.example`. A broken `sdlc.config.ts` surfaces as an
amber warning in Settings instead of silently falling back. `sandbox/smoke.sh`
lints the config and asserts the image build stamp (`sdlc.dockerfile-sha`).

### Residual risks (accepted)

- Target drift with no config change (e.g. a lockfile bump) keeps reusing the
  warm container ("Setup skipped") until the image is rebuilt.
- No per-branch tooling experiments without a config change: config is
  per-project; `POST /projects/reload` (or the Settings "Reload config" button)
  picks up edits and clears warm containers only for changed projects.
- Secrets resolve per gate into plaintext `docker exec -e` env, visible via
  `docker inspect` while the container runs.
- Changing `e2e.cwd`/`testDir` mid-task orphans the `sdlc-pw.config.ts`
  overlay written for the previous paths.

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
