import { Hono } from "hono";
import {
  CreateProjectInputSchema,
  TestConnectionInputSchema,
  UpdateProjectInputSchema,
  UpdateProjectSettingsInputSchema,
  UpsertSecretInputSchema,
  deployOverlapWarnings,
  type Project,
  type ProjectSettings,
  type ProjectSummary,
  type SandboxImageStatus,
} from "@sdlc-ai/shared";
import { env } from "../env.js";
import { HttpError } from "../errors.js";
import type { ProjectRegistry } from "../integrations/project-registry.js";
import {
  archiveProjectRecord,
  createProjectRecord,
  deleteProjectRecord,
  deleteProjectSecretRecord,
  restoreProjectRecord,
  updateProjectRecord,
  upsertProjectSecretRecord,
} from "../pipeline/projects-service.js";
import { listProjectSecretsMeta, listProjects, requireProject } from "../pipeline/tasks.js";
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
      archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
      activeTaskCount: counts.get(p.id) ?? 0,
      maxConcurrentTasks: p.maxConcurrentTasks,
      configHash: p.configHash,
    }));
    return c.json(summaries);
  });

  r.post("/test-connection", async (c) => {
    const input = await parseBody(c.req.raw, TestConnectionInputSchema);
    return c.json(await registry.testGitHubConnection(input));
  });

  r.post("/", async (c) => {
    const input = await parseBody(c.req.raw, CreateProjectInputSchema);
    const created = await createProjectRecord(registry, input);
    return c.json(await readSettings(workflow, registry, created.id), 201);
  });

  r.get("/:projectId", async (c) => {
    return c.json(await readSettings(workflow, registry, c.req.param("projectId")));
  });

  r.patch("/:projectId", async (c) => {
    const projectId = c.req.param("projectId");
    const input = await parseBody(c.req.raw, UpdateProjectInputSchema);
    const updated = await updateProjectRecord(workflow, registry, projectId, input);
    return c.json(await readSettings(workflow, registry, updated.id));
  });

  r.patch("/:projectId/settings", async (c) => {
    const projectId = c.req.param("projectId");
    const input = await parseBody(c.req.raw, UpdateProjectSettingsInputSchema);
    if (input.maxConcurrentTasks !== undefined) await workflow.updateMaxConcurrentTasks(projectId, input.maxConcurrentTasks);
    if (input.reuseSandbox !== undefined) await workflow.updateReuseSandbox(projectId, input.reuseSandbox);
    registry.invalidateProject((await requireProject(projectId)).id);
    return c.json(await readSettings(workflow, registry, projectId));
  });

  r.post("/:projectId/archive", async (c) => {
    const archived = await archiveProjectRecord(workflow, registry, c.req.param("projectId"));
    return c.json(await readSettings(workflow, registry, archived.id));
  });

  r.post("/:projectId/restore", async (c) => {
    const restored = await restoreProjectRecord(registry, c.req.param("projectId"));
    return c.json(await readSettings(workflow, registry, restored.id));
  });

  r.delete("/:projectId", async (c) => {
    return c.json(await deleteProjectRecord(workflow, registry, c.req.param("projectId")));
  });

  r.put("/:projectId/secrets/:name", async (c) => {
    const input = await parseBody(c.req.raw, UpsertSecretInputSchema);
    const meta = await upsertProjectSecretRecord(registry, c.req.param("projectId"), c.req.param("name"), input.value);
    return c.json(meta);
  });

  r.delete("/:projectId/secrets/:name", async (c) => {
    await deleteProjectSecretRecord(registry, c.req.param("projectId"), c.req.param("name"));
    return c.json({ ok: true });
  });

  r.get("/:projectId/manifest", async (c) => {
    const project = await requireProject(c.req.param("projectId"));
    return c.json({
      ok: true as const,
      manifest: project.manifest,
      hash: project.configHash,
      source: "database",
      loadedAt: project.updatedAt.toISOString(),
    });
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
  const [github, secretsMeta, projectActive, globalActive, sandboxImageStatus] = await Promise.all([
    runtime.github.connectionStatus(),
    listProjectSecretsMeta(project.id),
    workflow.activeTasks(project.id),
    workflow.activeTasks(),
    readSandboxImageStatus(runtime.sandboxImage),
  ]);
  const active = projectActive.map((t) => ({ id: t.id, title: t.title, stage: t.stage }));
  const deployWarnings = deployOverlapWarnings(project.deployTargets, project.manifest);
  const apiProject: Project = {
    id: project.id,
    slug: project.slug,
    name: project.name,
    owner: project.owner,
    repo: project.repo,
    defaultBranch: project.defaultBranch,
    manifest: project.manifest,
    deployTargets: project.deployTargets,
    deployProviders: project.deployProviders,
    models: project.models,
    sandboxImage: project.sandboxImage,
    configHash: project.configHash,
    maxConcurrentTasks: project.maxConcurrentTasks,
    reuseSandbox: project.reuseSandbox,
    archivedAt: project.archivedAt ? project.archivedAt.toISOString() : null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
  return {
    project: apiProject,
    github,
    manifest: {
      ok: true,
      manifest: project.manifest,
      hash: project.configHash,
      source: "database",
      loadedAt: project.updatedAt.toISOString(),
    },
    secrets: secretsMeta,
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
