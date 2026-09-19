import { Hono } from "hono";
import { env } from "../env.js";
import { errorMessage } from "../errors.js";
import { loadManifest } from "../integrations/manifest.js";
import { getProject } from "../pipeline/tasks.js";
import type { WorkflowService } from "../pipeline/workflow.js";

export function projectRoutes(workflow: WorkflowService) {
  const r = new Hono();

  r.get("/", async (c) => {
    const project = await getProject();
    const [github, manifest, active] = await Promise.all([
      workflow.deps.github.connectionStatus(),
      readManifest(workflow, project.defaultBranch),
      workflow.activeTask(),
    ]);
    return c.json({
      project,
      github,
      manifest,
      deployProviders: {
        CLOUDFLARE: Boolean(workflow.deps.deployProviders.CLOUDFLARE),
        RENDER: Boolean(workflow.deps.deployProviders.RENDER),
      },
      models: { developer: env.MODEL_DEVELOPER, fast: env.MODEL_FAST },
      sandboxImage: env.SANDBOX_IMAGE,
      fakes: env.SDLC_FAKES,
      activeTask: active ? { id: active.id, title: active.title, stage: active.stage } : null,
    });
  });

  r.get("/manifest", async (c) => {
    const project = await getProject();
    return c.json(await readManifest(workflow, project.defaultBranch));
  });

  return r;
}

async function readManifest(workflow: WorkflowService, ref: string) {
  try {
    return { ok: true as const, manifest: await loadManifest(workflow.deps.github, ref) };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}
