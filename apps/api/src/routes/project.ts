import { Hono } from "hono";
import { UpdateProjectSettingsInputSchema, type SandboxImageStatus } from "@sdlc-ai/shared";
import { env } from "../env.js";
import { errorMessage } from "../errors.js";
import { loadManifest } from "../integrations/manifest.js";
import { getProject } from "../pipeline/tasks.js";
import type { WorkflowService } from "../pipeline/workflow.js";
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
  return {
    project,
    github,
    manifest,
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
    return { ok: true as const, manifest: await loadManifest(workflow.deps.github, ref) };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}
