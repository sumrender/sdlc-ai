import { Hono } from "hono";
import {
  UpdateProjectSettingsInputSchema,
  deployOverlapWarnings,
  type ProjectSettings,
  type ProjectSummary,
  type SandboxImageStatus,
} from "@sdlc-ai/shared";
import { env } from "../env.js";
import { HttpError, errorMessage } from "../errors.js";
import {
  getLoadedProjectConfig,
  getProjectConfigHash,
  getProjectConfigMeta,
  loadManifestForSlug,
  reloadLocalProjectsConfig,
} from "../integrations/config-loader.js";
import type { ProjectRegistry } from "../integrations/project-registry.js";
import { listProjects, requireProject } from "../pipeline/tasks.js";
import type { WorkflowService } from "../pipeline/workflow.js";
import { checkSandboxImage } from "../sandbox/image-stamp.js";
import { parseBody, readJson } from "./app.js";

export function projectsRoutes(workflow: WorkflowService, registry: ProjectRegistry) {
  const r = new Hono();

  r.get("/", async (c) => {
    const [allProjects, activeAll] = await Promise.all([listProjects(), workflow.activeTasks()]);
    const counts = new Map<string, number>();
    for (const t of activeAll) {
      counts.set(t.projectId, (counts.get(t.projectId) ?? 0) + 1);
    }
    const summaries: ProjectSummary[] = allProjects.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      owner: p.owner,
      repo: p.repo,
      defaultBranch: p.defaultBranch,
      active: p.active,
      activeTaskCount: counts.get(p.id) ?? 0,
      maxConcurrentTasks: p.maxConcurrentTasks,
      configOk: Boolean(getLoadedProjectConfig(p.slug)),
      configHash: getProjectConfigHash(p.slug),
    }));
    return c.json(summaries);
  });

  // Force a fresh sdlc.config.ts import, sync projects, and drop warm containers
  // only for projects whose manifest hash changed. Returns 200 with {ok:false}
  // on failure — never 500, never exits.
  r.post("/reload", async (c) => {
    const read = await reloadLocalProjectsConfig();
    if (!read.ok) return c.json({ ok: false as const, error: read.error }, 200);
    await registry.syncProjects(read);
    await workflow.clearWarmSandboxesForSlugs(read.changedSlugs);
    if (read.changedSlugs.length > 0) {
      console.log(`[config] reload changed [${read.changedSlugs.join(", ")}]; warm containers cleared for changed projects`);
    }
    return c.json({
      ok: true as const,
      source: read.source,
      loadedAt: read.loadedAt,
      projects: read.list.map((p) => ({ slug: p.slug, hash: p.hash, epoch: p.epoch })),
      changedSlugs: read.changedSlugs,
    });
  });

  r.get("/:projectId", async (c) => {
    return c.json(await readSettings(workflow, registry, c.req.param("projectId")));
  });

  r.patch("/:projectId/settings", async (c) => {
    const projectId = c.req.param("projectId");
    const input = await parseBody(c.req.raw, UpdateProjectSettingsInputSchema);
    if (input.maxConcurrentTasks !== undefined) await workflow.updateMaxConcurrentTasks(projectId, input.maxConcurrentTasks);
    if (input.reuseSandbox !== undefined) await workflow.updateReuseSandbox(projectId, input.reuseSandbox);
    return c.json(await readSettings(workflow, registry, projectId));
  });

  r.get("/:projectId/manifest", async (c) => {
    const project = await requireProject(c.req.param("projectId"));
    return c.json(await readManifest(project.slug));
  });

  r.post("/:projectId/demo/run", async (c) => {
    const task = await workflow.runDemo(c.req.param("projectId"));
    return c.json(await workflow.boardTask(task.id), 201);
  });

  r.post("/:projectId/demo/reset", async (c) => {
    const body = await readJson(c.req.raw);
    if ((body as { confirm?: unknown })?.confirm !== true) throw new HttpError(400, 'Reset requires { "confirm": true }');
    return c.json(await workflow.resetDemo(c.req.param("projectId")));
  });

  return r;
}

async function readSettings(workflow: WorkflowService, registry: ProjectRegistry, projectIdOrSlug: string): Promise<ProjectSettings> {
  const runtime = await registry.forProject(projectIdOrSlug);
  const { project } = runtime;
  const [github, manifest, projectActive, globalActive, sandboxImageStatus] = await Promise.all([
    runtime.github.connectionStatus(),
    readManifest(project.slug),
    workflow.activeTasks(project.id),
    workflow.activeTasks(),
    // Re-read every request (not cached) so the warning clears as soon as the image is rebuilt.
    readSandboxImageStatus(runtime.sandboxImage),
  ]);
  const active = projectActive.map((t) => ({ id: t.id, title: t.title, stage: t.stage }));
  const deployWarnings = manifest.ok ? deployOverlapWarnings(project.deployTargets, manifest.manifest) : [];
  for (const w of deployWarnings) console.warn(`[config:${project.slug}] ${w}`);
  return {
    project: { ...project, createdAt: project.createdAt.toISOString() },
    github,
    manifest,
    deployWarnings,
    deployProviders: {
      CLOUDFLARE: Boolean(runtime.deployProviders.CLOUDFLARE),
      RENDER: Boolean(runtime.deployProviders.RENDER),
    },
    models: runtime.models,
    sandboxImage: runtime.sandboxImage,
    sandboxImageStatus,
    fakes: env.SDLC_FAKES,
    activeTask: active[0] ?? null,
    activeTasks: active,
    activeTaskCount: active.length,
    maxConcurrentTasks: project.maxConcurrentTasks ?? 3,
    reuseSandbox: project.reuseSandbox ?? true,
    globalActiveTaskCount: globalActive.length,
    maxGlobalConcurrentTasks: env.MAX_GLOBAL_CONCURRENT_TASKS,
  };
}

/** With fakes there is no Docker host, so there is no image to be stale. */
async function readSandboxImageStatus(image: string): Promise<SandboxImageStatus> {
  if (env.SDLC_FAKES) return { ok: true, warning: null };
  return checkSandboxImage(image, env.DOCKER_BIN);
}

async function readManifest(slug: string) {
  try {
    const manifest = await loadManifestForSlug(slug);
    return { ok: true as const, manifest, ...getProjectConfigMeta(slug) };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}
