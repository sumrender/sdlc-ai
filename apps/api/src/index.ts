import { serve } from "@hono/node-server";
import { ArtifactStore } from "./artifacts/store.js";
import { closeDb, db, runMigrations } from "./db/index.js";
import { projects } from "./db/schema.js";
import { env } from "./env.js";
import { FakeSandboxRunner } from "./fakes/index.js";
import { startConfigWatch } from "./integrations/config-loader.js";
import { ProjectRegistry } from "./integrations/project-registry.js";
import { WorkflowService } from "./pipeline/workflow.js";
import type { SandboxRunner } from "./ports.js";
import { createApp } from "./routes/app.js";
import { DockerSandboxRunner } from "./sandbox/docker.js";
import { checkSandboxImage } from "./sandbox/image-stamp.js";
import { TaskSandboxPool } from "./sandbox/task-pool.js";

const STAGING_POLL_MS = 5_000;

function createSandboxPool(): { sandboxes: TaskSandboxPool; fakeRunner: FakeSandboxRunner | null } {
  if (env.SDLC_FAKES) {
    console.warn("[api] SDLC_FAKES=true — Docker, GitHub and deploy providers are in-memory fakes");
    const fakeRunner = new FakeSandboxRunner();
    return { sandboxes: new TaskSandboxPool(fakeRunner as SandboxRunner), fakeRunner };
  }
  if (!env.OPENCODE_API_KEY) {
    console.error("[api] missing required environment: OPENCODE_API_KEY (or set SDLC_FAKES=true)");
    process.exit(1);
  }
  return {
    sandboxes: new TaskSandboxPool(new DockerSandboxRunner(env.SANDBOX_IMAGE, env.DOCKER_BIN)),
    fakeRunner: null,
  };
}

async function main() {
  await runMigrations();

  const { sandboxes, fakeRunner } = createSandboxPool();
  const registry = new ProjectRegistry({
    fakes: env.SDLC_FAKES,
    env,
    onFakeGitHub: fakeRunner ? (cloneUrl, gh) => fakeRunner.registerGitHub(cloneUrl, gh) : undefined,
  });

  const configRead = await registry.syncProjects();
  if (configRead.ok) {
    const summary = configRead.list.map((p) => `${p.slug} (${p.hash.slice(0, 12)})`).join(", ");
    console.log(`[api] loaded ${configRead.list.length} project(s) from ${configRead.source}: ${summary}`);
  } else {
    console.warn(`[api] local config unavailable: ${configRead.error}`);
  }

  const workflow = new WorkflowService({
    sandboxes,
    forProject: (id) => registry.forProject(id),
    artifacts: new ArtifactStore(env.ARTIFACTS_DIR),
  });

  // Config change bumps per-project epochs and drops warm containers only for changed slugs.
  const stopConfigWatch = startConfigWatch({
    onReload: async (changedSlugs, read) => {
      await registry.syncProjects(read);
      await workflow.clearWarmSandboxesForSlugs(changedSlugs);
      console.log(`[config] ${read.source} changed [${changedSlugs.join(", ")}]; warm containers cleared for changed projects`);
    },
  });

  const app = createApp(workflow, registry);

  const dbProjects = await db.select().from(projects);
  for (const p of dbProjects) {
    if (!p.active) continue;
    const runtime = await registry.forProject(p.id);
    const github = await runtime.github.connectionStatus();
    if (github.ok) console.log(`[api] [${p.slug}] GitHub connected as ${github.login} to ${p.owner}/${p.repo}`);
    else console.warn(`[api] [${p.slug}] GitHub check failed: ${github.error}`);
  }

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
    console.log(`[api] listening on http://localhost:${info.port} (${dbProjects.filter((p) => p.active).length} active project(s))`);
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
