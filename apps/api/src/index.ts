import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import type { DeployTargetConfig, Provider } from "@sdlc-ai/shared";
import { ArtifactStore } from "./artifacts/store.js";
import { closeDb, db, runMigrations } from "./db/index.js";
import { projects } from "./db/schema.js";
import { env } from "./env.js";
import { FakeDeployProvider, FakeGitHubService, FakeSandboxRunner } from "./fakes/index.js";
import { CloudflareDeployProvider } from "./integrations/cloudflare.js";
import { OctokitGitHubService } from "./integrations/github.js";
import { RenderDeployProvider } from "./integrations/render.js";
import { WorkflowService } from "./pipeline/workflow.js";
import type { DeployProvider, GitHubService, SandboxRunner } from "./ports.js";
import { DockerSandboxRunner } from "./sandbox/docker.js";
import { createApp } from "./routes/app.js";

const STAGING_POLL_MS = 5_000;

async function seedProject() {
  const deployTargets: DeployTargetConfig[] = [
    { target: "FE", provider: "CLOUDFLARE", pathPrefix: "fe/", url: env.FE_ORIGIN ?? null },
    { target: "BE", provider: "RENDER", pathPrefix: "be/", url: env.BE_ORIGIN ?? null },
  ];
  const values = {
    name: env.GITHUB_REPO,
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    defaultBranch: env.GITHUB_DEFAULT_BRANCH,
    deployTargets,
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
      sandboxes: new FakeSandboxRunner(github),
      deployProviders: {
        CLOUDFLARE: new FakeDeployProvider(env.FE_ORIGIN ?? "https://fe.stage.example"),
        RENDER: new FakeDeployProvider(env.BE_ORIGIN ?? "https://be.stage.example"),
      },
    };
  }

  const missing = (["GITHUB_TOKEN", "ANTHROPIC_API_KEY"] as const).filter((k) => !env[k]);
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
    sandboxes: new DockerSandboxRunner(env.SANDBOX_IMAGE, env.DOCKER_BIN),
    deployProviders,
  };
}

async function main() {
  await runMigrations();
  await seedProject();

  const workflow = new WorkflowService({ ...wireIntegrations(), artifacts: new ArtifactStore(env.ARTIFACTS_DIR) });
  const app = createApp(workflow);

  await workflow.recover();
  const ticker = setInterval(() => void workflow.pollStaging().catch((e) => console.error("[api] staging poll failed", e)), STAGING_POLL_MS);

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`[api] listening on http://localhost:${info.port} (project ${env.GITHUB_OWNER}/${env.GITHUB_REPO})`);
  });

  const shutdown = () => {
    clearInterval(ticker);
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
