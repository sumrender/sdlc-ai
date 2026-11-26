import { and, eq } from "drizzle-orm";
import {
  SecretNameSchema,
  hashManifest,
  resolveDeployTargetUrls,
  slugifyProject,
  type CreateProjectInput,
  type DeleteProjectResult,
  type SecretMeta,
  type SecretsWriteMap,
  type UpdateProjectInput,
} from "@sdlc-ai/shared";
import { secretCrypto } from "../crypto/secrets.js";
import { db } from "../db/index.js";
import { projectSecrets, projects, tasks, type ProjectRow } from "../db/schema.js";
import { HttpError } from "../errors.js";
import { bus } from "../events/bus.js";
import type { ProjectRegistry } from "../integrations/project-registry.js";
import { requireProject } from "./tasks.js";
import type { WorkflowService } from "./workflow.js";

async function assertNoRunningTasks(projectId: string, actionLabel: string): Promise<void> {
  const running = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.status, "RUNNING")))
    .limit(1);
  if (running.length > 0) {
    throw new HttpError(
      409,
      `Cannot ${actionLabel} project while task "${running[0]!.title}" is RUNNING. Stop it first.`,
    );
  }
}

async function applySecretWrites(projectId: string, secrets: SecretsWriteMap | undefined): Promise<void> {
  if (!secrets) return;
  const now = new Date();
  for (const [rawName, value] of Object.entries(secrets)) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const name = SecretNameSchema.parse(rawName);
    const { ciphertext, hint } = secretCrypto.encrypt(trimmed);
    await db
      .insert(projectSecrets)
      .values({ projectId, name, ciphertext, hint, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [projectSecrets.projectId, projectSecrets.name],
        set: { ciphertext, hint, updatedAt: now },
      });
  }
}

export async function createProjectRecord(
  registry: ProjectRegistry,
  input: CreateProjectInput,
): Promise<ProjectRow> {
  const slug = input.slug ?? slugifyProject(input.repository.repo);
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (existing) {
    throw new HttpError(409, `A project with slug "${slug}" already exists.`);
  }

  const deployTargets = resolveDeployTargetUrls(input.deployTargets, input.deployProviders);
  const configHash = hashManifest(input.manifest);
  const now = new Date();

  const [created] = await db
    .insert(projects)
    .values({
      slug,
      name: input.name ?? input.repository.repo,
      owner: input.repository.owner,
      repo: input.repository.repo,
      defaultBranch: input.repository.defaultBranch,
      manifest: input.manifest,
      deployTargets,
      deployProviders: input.deployProviders,
      models: input.models ?? null,
      sandboxImage: input.sandboxImage ?? null,
      configHash,
      maxConcurrentTasks: input.maxConcurrentTasks,
      reuseSandbox: input.reuseSandbox,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const project = created!;
  await applySecretWrites(project.id, input.secrets);
  registry.invalidateProject(project.id);
  return project;
}

export async function updateProjectRecord(
  workflow: WorkflowService,
  registry: ProjectRegistry,
  idOrSlug: string,
  input: UpdateProjectInput,
): Promise<ProjectRow> {
  const prev = await requireProject(idOrSlug);
  const nextManifest = input.manifest ?? prev.manifest;
  const nextProviders = input.deployProviders ?? prev.deployProviders;
  const nextTargets = resolveDeployTargetUrls(input.deployTargets ?? prev.deployTargets, nextProviders);
  const nextConfigHash = hashManifest(nextManifest);
  const nextSandboxImage = input.sandboxImage !== undefined ? input.sandboxImage : prev.sandboxImage;
  const now = new Date();

  const [updated] = await db
    .update(projects)
    .set({
      name: input.name ?? prev.name,
      owner: input.repository?.owner ?? prev.owner,
      repo: input.repository?.repo ?? prev.repo,
      defaultBranch: input.repository?.defaultBranch ?? prev.defaultBranch,
      manifest: nextManifest,
      deployTargets: nextTargets,
      deployProviders: nextProviders,
      models: input.models !== undefined ? input.models : prev.models,
      sandboxImage: nextSandboxImage,
      configHash: nextConfigHash,
      maxConcurrentTasks: input.maxConcurrentTasks ?? prev.maxConcurrentTasks,
      reuseSandbox: input.reuseSandbox ?? prev.reuseSandbox,
      updatedAt: now,
    })
    .where(eq(projects.id, prev.id))
    .returning();

  await applySecretWrites(prev.id, input.secrets);
  registry.invalidateProject(prev.id);

  if (nextConfigHash !== prev.configHash || nextSandboxImage !== prev.sandboxImage) {
    await workflow.clearWarmSandboxesForProject(prev.id);
  }
  return updated!;
}

export async function archiveProjectRecord(
  workflow: WorkflowService,
  registry: ProjectRegistry,
  idOrSlug: string,
): Promise<ProjectRow> {
  const project = await requireProject(idOrSlug);
  await assertNoRunningTasks(project.id, "archive");
  const now = new Date();
  const [updated] = await db
    .update(projects)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(projects.id, project.id))
    .returning();
  await workflow.clearWarmSandboxesForProject(project.id);
  registry.invalidateProject(project.id);
  return updated!;
}

export async function restoreProjectRecord(
  registry: ProjectRegistry,
  idOrSlug: string,
): Promise<ProjectRow> {
  const project = await requireProject(idOrSlug);
  const now = new Date();
  const [updated] = await db
    .update(projects)
    .set({ archivedAt: null, updatedAt: now })
    .where(eq(projects.id, project.id))
    .returning();
  registry.invalidateProject(project.id);
  return updated!;
}

export async function deleteProjectRecord(
  workflow: WorkflowService,
  registry: ProjectRegistry,
  idOrSlug: string,
): Promise<DeleteProjectResult> {
  const project = await requireProject(idOrSlug);
  await assertNoRunningTasks(project.id, "delete");

  const projectTasks = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.projectId, project.id));

  await workflow.clearWarmSandboxesForProject(project.id);
  for (const t of projectTasks) {
    await workflow.deps.artifacts.clearTask(t.id);
    workflow.dropTaskChain(t.id);
    bus.unbindTask(t.id);
  }

  await db.delete(projects).where(eq(projects.id, project.id));
  registry.invalidateProject(project.id);
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    tasksDeleted: projectTasks.length,
  };
}

export async function upsertProjectSecretRecord(
  registry: ProjectRegistry,
  idOrSlug: string,
  rawName: string,
  value: string,
): Promise<SecretMeta> {
  const project = await requireProject(idOrSlug);
  const parsedName = SecretNameSchema.safeParse(rawName);
  if (!parsedName.success) {
    throw new HttpError(400, parsedName.error.issues[0]?.message ?? "Invalid secret name");
  }
  const { ciphertext, hint } = secretCrypto.encrypt(value);
  const now = new Date();
  const [row] = await db
    .insert(projectSecrets)
    .values({
      projectId: project.id,
      name: parsedName.data,
      ciphertext,
      hint,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [projectSecrets.projectId, projectSecrets.name],
      set: { ciphertext, hint, updatedAt: now },
    })
    .returning();
  await db.update(projects).set({ updatedAt: now }).where(eq(projects.id, project.id));
  registry.invalidateProject(project.id);
  return { name: row!.name, hint: row!.hint, updatedAt: row!.updatedAt.toISOString() };
}

export async function deleteProjectSecretRecord(
  registry: ProjectRegistry,
  idOrSlug: string,
  rawName: string,
): Promise<void> {
  const project = await requireProject(idOrSlug);
  const now = new Date();
  await db
    .delete(projectSecrets)
    .where(and(eq(projectSecrets.projectId, project.id), eq(projectSecrets.name, rawName)));
  await db.update(projects).set({ updatedAt: now }).where(eq(projects.id, project.id));
  registry.invalidateProject(project.id);
}
