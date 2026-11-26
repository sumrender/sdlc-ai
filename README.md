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

Then configure `SECRETS_ENCRYPTION_KEY` (32-byte key via `openssl rand -hex 32`), `OPENCODE_API_KEY`, and `SDLC_FAKES=false` in `.env`, run `pnpm dev`, and create/edit Projects directly from the web UI (`/projects/new` and Project Settings) with per-project GitHub tokens and deploy secrets.

## Project config & encrypted secrets

Projects (slug, repository, setup/checks/unit-test/E2E manifest, deploy targets, provider IDs, optional model/sandbox overrides) are stored in PostgreSQL and managed directly from the UI via CRUD endpoints (`POST /projects`, `PATCH /projects/:projectId`, archive/restore, permanent delete). Each Task snapshots its project's manifest at Start so mid-flight edits do not mutate running Tasks, and updating a project selectively clears warm sandbox containers for that project.

Per-project credentials (`GITHUB_TOKEN`, `RENDER_API_KEY`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`, plus custom secrets referenced via `{ env: "NAME" }` in unit tests/E2E) live in the `project_secrets` table encrypted with AES-256-GCM using `SECRETS_ENCRYPTION_KEY` (with optional `SECRETS_ENCRYPTION_KEY_PREVIOUS` for key rotation). Global infrastructure settings stay in `.env` (`DATABASE_URL`, `SECRETS_ENCRYPTION_KEY`, `OPENCODE_API_KEY`, `MAX_GLOBAL_CONCURRENT_TASKS`, `SANDBOX_IMAGE`); see `.env.example`.

### Residual risks (accepted)

- Target drift with no manifest change (e.g. a lockfile bump) keeps reusing the
  warm container ("Setup skipped") until the image is rebuilt.
- No per-branch tooling experiments without editing the project's manifest:
  edits in Settings clear warm containers for that project automatically.
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
