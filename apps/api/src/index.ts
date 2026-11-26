import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import type { Provider } from "@sdlc-ai/shared";
import { ArtifactStore } from "./artifacts/store.js";
import { closeDb, db, runMigrations } from "./db/index.js";
import { projects } from "./db/schema.js";
import { env } from "./env.js";
import { FakeDeployProvider, FakeGitHubService, FakeSandboxRunner } from "./fakes/index.js";
import { CloudflareDeployProvider } from "./integrations/cloudflare.js";
import { getConfigEpoch, loadLocalConfig, startConfigWatch } from "./integrations/config-loader.js";
import { OctokitGitHubService } from "./integrations/github.js";
import { loadProjectRow } from "./integrations/project-row.js";
import { RenderDeployProvider } from "./integrations/render.js";
import { WorkflowService } from "./pipeline/workflow.js";
import type { DeployProvider, GitHubService, SandboxRunner } from "./ports.js";
import { DockerSandboxRunner } from "./sandbox/docker.js";
import { checkSandboxImage } from "./sandbox/image-stamp.js";
import { TaskSandboxPool } from "./sandbox/task-pool.js";
import { createApp } from "./routes/app.js";

const STAGING_POLL_MS = 5_000;

async function seedProject() {
  const row = await loadProjectRow(env);
  const values = {
    name: row.name,
    owner: row.owner,
    repo: row.repo,
    defaultBranch: row.defaultBranch,
    deployTargets: row.deployTargets,
  };
  const [existing] = await db.select().from(projects).limit(1);
  if (existing) {
    await db.update(projects).set(values).where(eq(projects.id, existing.id));
    return;
  }
  await db.insert(projects).values(values);
}

function wireIntegrations(): { sandboxes: SandboxRunner; github: GitHubService; deployProviders: Partial<Record<Provider, DeployProvider>> } {
  if (env.SDLC_FAKES) {
    console.warn("[api] SDLC_FAKES=true — Docker, GitHub and deploy providers are in-memory fakes");
    const github = new FakeGitHubService();
    return {
      github,
      sandboxes: new TaskSandboxPool(new FakeSandboxRunner(github)),
      deployProviders: {
        CLOUDFLARE: new FakeDeployProvider(env.FE_ORIGIN ?? "https://fe.stage.example"),
        RENDER: new FakeDeployProvider(env.BE_ORIGIN ?? "https://be.stage.example"),
      },
    };
  }

  const missing = (["GITHUB_TOKEN", "OPENCODE_API_KEY"] as const).filter((k) => !env[k]);
  if (missing.length) {
    console.error(`[api] missing required environment: ${missing.join(", ")} (or set SDLC_FAKES=true)`);
    process.exit(1);
  }

  const deployProviders: Partial<Record<Provider, DeployProvider>> = {};
  if (env.RENDER_API_KEY && env.RENDER_SERVICE_ID) {
    deployProviders.RENDER = new RenderDeployProvider(env.RENDER_API_KEY, env.RENDER_SERVICE_ID, env.BE_ORIGIN ?? null);
  }
  if (env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.CF_WORKER_NAME) {
    deployProviders.CLOUDFLARE = new CloudflareDeployProvider(env.CF_API_TOKEN, env.CF_ACCOUNT_ID, env.CF_WORKER_NAME, env.FE_ORIGIN ?? null);
  }
  return {
    github: new OctokitGitHubService(env.GITHUB_TOKEN!, env.GITHUB_OWNER, env.GITHUB_REPO),
    sandboxes: new TaskSandboxPool(new DockerSandboxRunner(env.SANDBOX_IMAGE, env.DOCKER_BIN)),
    deployProviders,
  };
}

async function main() {
  await runMigrations();
  await seedProject();

  // Prime the local-config cache. Warn-only; never exits.
  {
    const read = await loadLocalConfig();
    if (read.ok) console.log(`[api] local config ${read.source} rev ${read.hash.slice(0, 12)} (epoch ${getConfigEpoch()})`);
    else console.warn(`[api] local config unavailable: ${read.error}`);
  }

  const workflow = new WorkflowService({ ...wireIntegrations(), artifacts: new ArtifactStore(env.ARTIFACTS_DIR) });

  // Config change bumps the epoch into the setup hash and drops warm containers.
  const stopConfigWatch = startConfigWatch({
    onReload: async (info) => {
      const pool = workflow.deps.sandboxes instanceof TaskSandboxPool ? workflow.deps.sandboxes : null;
      if (pool) await pool.clear().catch(() => undefined);
      console.log(`[config] ${info.source} changed → rev ${info.hash.slice(0, 12)} (epoch ${info.epoch}); warm containers cleared`);
    },
  });
  const app = createApp(workflow);

  const github = await workflow.deps.github.connectionStatus();
  if (github.ok) console.log(`[api] GitHub connected as ${github.login} to ${env.GITHUB_OWNER}/${env.GITHUB_REPO}`);
  else console.warn(`[api] GitHub check failed: ${github.error} — creating Tasks and Planning will fail until GITHUB_TOKEN is fixed`);

  // Warn only: a stale image still runs, it just silently drops tooling the Dockerfile adds.
  if (!env.SDLC_FAKES) {
    const image = await checkSandboxImage(env.SANDBOX_IMAGE, env.DOCKER_BIN);
    if (image.ok) console.log(`[api] sandbox image ${env.SANDBOX_IMAGE} matches sandbox/Dockerfile`);
    else console.warn(`[api] STALE SANDBOX IMAGE — ${image.warning}`);
  }

  if (env.SDLC_RESUME_ON_START) await workflow.recover();
  else console.warn("[api] SDLC_RESUME_ON_START=false — open Tasks are not resumed on boot");
  const ticker = setInterval(() => void workflow.pollStaging().catch((e) => console.error("[api] staging poll failed", e)), STAGING_POLL_MS);

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`[api] listening on http://localhost:${info.port} (project ${env.GITHUB_OWNER}/${env.GITHUB_REPO})`);
  });

  const shutdown = () => {
    clearInterval(ticker);
    stopConfigWatch();
    server.close();
    void closeDb().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[api] fatal:", e);
  process.exit(1);
});
