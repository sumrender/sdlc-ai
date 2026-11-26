import { Hono } from "hono";
import { UpdateProjectSettingsInputSchema, deployOverlapWarnings, type SandboxImageStatus } from "@sdlc-ai/shared";
import { env } from "../env.js";
import { errorMessage } from "../errors.js";
import { getConfigEpoch, getCurrentConfigMeta, reloadLocalConfig } from "../integrations/config-loader.js";
import { loadManifest } from "../integrations/manifest.js";
import { getProject } from "../pipeline/tasks.js";
import type { WorkflowService } from "../pipeline/workflow.js";
import { TaskSandboxPool } from "../sandbox/task-pool.js";
import { checkSandboxImage } from "../sandbox/image-stamp.js";
import { parseBody } from "./app.js";

export function projectRoutes(workflow: WorkflowService) {
  const r = new Hono();

  r.get("/", async (c) => {
    return c.json(await readSettings(workflow));
  });

  r.patch("/settings", async (c) => {
    const input = await parseBody(c.req.raw, UpdateProjectSettingsInputSchema);
    if (input.maxConcurrentTasks !== undefined) await workflow.updateMaxConcurrentTasks(input.maxConcurrentTasks);
    if (input.reuseSandbox !== undefined) await workflow.updateReuseSandbox(input.reuseSandbox);
    return c.json(await readSettings(workflow));
  });

  r.get("/manifest", async (c) => {
    const project = await getProject();
    return c.json(await readManifest(workflow, project.defaultBranch));
  });

  // Force a fresh sdlc.config.ts import and drop warm containers. 200 with
  // {ok:false} on failure — never 500, never exits.
  r.post("/config/reload", async (c) => {
    const read = await reloadLocalConfig();
    if (!read.ok) return c.json({ ok: false as const, error: read.error }, 200);
    const pool = workflow.deps.sandboxes instanceof TaskSandboxPool ? workflow.deps.sandboxes : null;
    if (pool) await pool.clear().catch(() => undefined);
    console.log(`[config] reload: ${read.source} rev ${read.hash.slice(0, 12)} (epoch ${getConfigEpoch()}); warm containers cleared`);
    return c.json({ ok: true as const, source: read.source, hash: read.hash, epoch: getConfigEpoch(), loadedAt: read.loadedAt });
  });

  return r;
}

async function readSettings(workflow: WorkflowService) {
  const project = await getProject();
  const [github, manifest, activeTasks, sandboxImageStatus] = await Promise.all([
    workflow.deps.github.connectionStatus(),
    readManifest(workflow, project.defaultBranch),
    workflow.activeTasks(),
    // Re-read every request (not cached) so the warning clears as soon as the image is rebuilt.
    readSandboxImageStatus(),
  ]);
  const active = activeTasks.map((t) => ({ id: t.id, title: t.title, stage: t.stage }));
  const deployWarnings = manifest.ok ? deployOverlapWarnings(project.deployTargets, manifest.manifest) : [];
  for (const w of deployWarnings) console.warn(`[config] ${w}`);
  return {
    project,
    github,
    manifest,
    deployWarnings,
    deployProviders: {
      CLOUDFLARE: Boolean(workflow.deps.deployProviders.CLOUDFLARE),
      RENDER: Boolean(workflow.deps.deployProviders.RENDER),
    },
    models: { developer: env.MODEL_DEVELOPER, fast: env.MODEL_FAST },
    sandboxImage: env.SANDBOX_IMAGE,
    sandboxImageStatus,
    fakes: env.SDLC_FAKES,
    activeTask: active[0] ?? null,
    activeTasks: active,
    activeTaskCount: active.length,
    maxConcurrentTasks: project.maxConcurrentTasks ?? 3,
    reuseSandbox: project.reuseSandbox ?? true,
  };
}

/** With fakes there is no Docker host, so there is no image to be stale. */
async function readSandboxImageStatus(): Promise<SandboxImageStatus> {
  if (env.SDLC_FAKES) return { ok: true, warning: null };
  return checkSandboxImage(env.SANDBOX_IMAGE, env.DOCKER_BIN);
}

async function readManifest(workflow: WorkflowService, ref: string) {
  try {
    const manifest = await loadManifest(workflow.deps.github, ref);
    // Rev metadata for the Settings label; absent until the first read.
    return { ok: true as const, manifest, ...getCurrentConfigMeta() };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}
