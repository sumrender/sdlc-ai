import { eq, notInArray } from "drizzle-orm";
import { buildProjectRow, deployOverlapWarnings, type ProjectConfig, type Provider } from "@sdlc-ai/shared";
import { db } from "../db/index.js";
import { projects, type ProjectRow } from "../db/schema.js";
import type { Env } from "../env.js";
import { FakeDeployProvider, FakeGitHubService } from "../fakes/index.js";
import { requireProject } from "../pipeline/tasks.js";
import type { DeployProvider, GitHubService } from "../ports.js";
import { CloudflareDeployProvider } from "./cloudflare.js";
import {
  getLoadedProjectConfig,
  loadLocalProjectsConfig,
  type LocalProjectsConfigRead,
} from "./config-loader.js";
import { OctokitGitHubService } from "./github.js";
import { RenderDeployProvider } from "./render.js";

export interface ProjectRuntime {
  project: ProjectRow;
  github: GitHubService;
  deployProviders: Partial<Record<Provider, DeployProvider>>;
  sandboxImage: string;
  models: { developer: string; fast: string };
}

export interface ProjectRegistryOptions {
  fakes: boolean;
  env: Pick<Env, "SANDBOX_IMAGE" | "MODEL_DEVELOPER" | "MODEL_FAST">;
  resolveProject?: (idOrSlug: string) => Promise<ProjectRow>;
  envLookup?: (name: string) => string | undefined;
  getConfig?: (slug: string) => ProjectConfig | null;
  onFakeGitHub?: (cloneUrl: string, github: FakeGitHubService) => void;
}

class UnconfiguredGitHubService implements GitHubService {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly tokenEnv: string,
  ) {}

  private fail(): never {
    throw new Error(`Missing GitHub token env var "${this.tokenEnv}" for ${this.owner}/${this.repo}`);
  }

  cloneUrl(): string {
    return `https://github.com/${this.owner}/${this.repo}.git`;
  }
  gitAuthHeader(): string {
    return this.fail();
  }
  createIssue(): Promise<{ number: number; url: string }> {
    return this.fail();
  }
  getIssue(): Promise<never> {
    return this.fail();
  }
  createPullRequest(): Promise<{ number: number; url: string }> {
    return this.fail();
  }
  getPullRequest(): Promise<never> {
    return this.fail();
  }
  getChangedFiles(): Promise<string[]> {
    return this.fail();
  }
  squashMerge(): Promise<{ sha: string }> {
    return this.fail();
  }
  deleteBranch(): Promise<void> {
    return this.fail();
  }
  branchExists(): Promise<boolean> {
    return this.fail();
  }
  closeIssue(): Promise<void> {
    return this.fail();
  }
  closePullRequest(): Promise<void> {
    return this.fail();
  }
  listBranches(): Promise<string[]> {
    return this.fail();
  }
  getFileContent(): Promise<string | null> {
    return this.fail();
  }
  async connectionStatus() {
    return { ok: false, error: `Missing GitHub token env var "${this.tokenEnv}"` };
  }
  createComment(): Promise<{ id: number; url: string }> {
    return this.fail();
  }
  listComments(): Promise<Array<{ id: number; body: string }>> {
    return this.fail();
  }
  updateComment(): Promise<void> {
    return this.fail();
  }
  getPullRequestBody(): Promise<string> {
    return this.fail();
  }
  updatePullRequestBody(): Promise<void> {
    return this.fail();
  }
}

export class ProjectRegistry {
  private readonly cache = new Map<string, { signature: string; runtime: Omit<ProjectRuntime, "project"> }>();
  private readonly resolveProject: (idOrSlug: string) => Promise<ProjectRow>;
  private readonly envLookup: (name: string) => string | undefined;
  private readonly getConfig: (slug: string) => ProjectConfig | null;

  constructor(private readonly options: ProjectRegistryOptions) {
    this.resolveProject = options.resolveProject ?? requireProject;
    this.envLookup = options.envLookup ?? ((name) => process.env[name]);
    this.getConfig = options.getConfig ?? getLoadedProjectConfig;
  }

  /**
   * Sync every project declared in sdlc.config.ts into the projects table.
   * Removed slugs are marked active=false so historical tasks remain intact.
   */
  async syncProjects(existingRead?: LocalProjectsConfigRead): Promise<LocalProjectsConfigRead> {
    const read = existingRead ?? (await loadLocalProjectsConfig());
    if (!read.ok) {
      console.warn(`[registry] local config unavailable: ${read.error}`);
      return read;
    }

    const activeSlugs: string[] = [];
    for (const entry of read.list) {
      const row = buildProjectRow(entry.config);
      activeSlugs.push(row.slug);
      for (const warning of deployOverlapWarnings(row.deployTargets, entry.manifest)) {
        console.warn(`[config:${row.slug}] ${warning}`);
      }
      await db
        .insert(projects)
        .values({
          slug: row.slug,
          name: row.name,
          owner: row.owner,
          repo: row.repo,
          defaultBranch: row.defaultBranch,
          deployTargets: row.deployTargets,
          active: true,
          ...(row.maxConcurrentTasks !== undefined ? { maxConcurrentTasks: row.maxConcurrentTasks } : {}),
          ...(row.reuseSandbox !== undefined ? { reuseSandbox: row.reuseSandbox } : {}),
        })
        .onConflictDoUpdate({
          target: projects.slug,
          set: {
            name: row.name,
            owner: row.owner,
            repo: row.repo,
            defaultBranch: row.defaultBranch,
            deployTargets: row.deployTargets,
            active: true,
          },
        });
    }

    if (activeSlugs.length > 0) {
      await db.update(projects).set({ active: false }).where(notInArray(projects.slug, activeSlugs));
    }

    this.invalidateBySlugs(read.changedSlugs);
    return read;
  }

  async forProject(idOrSlug: string): Promise<ProjectRuntime> {
    const project = await this.resolveProject(idOrSlug);
    let config = this.getConfig(project.slug);
    if (!config && this.getConfig === getLoadedProjectConfig) {
      const read = await loadLocalProjectsConfig();
      if (read.ok) config = read.projects.get(project.slug)?.config ?? null;
    }

    const signature = this.runtimeSignature(project, config);
    const cached = this.cache.get(project.id);
    if (cached && cached.signature === signature) {
      return { project, ...cached.runtime };
    }

    const runtime = this.buildRuntime(project, config);
    this.cache.set(project.id, { signature, runtime });
    return { project, ...runtime };
  }

  invalidateBySlugs(slugs: readonly string[]): void {
    if (slugs.length === 0) return;
    const set = new Set(slugs);
    for (const [id, entry] of this.cache.entries()) {
      const slug = entry.signature.split("|", 1)[0];
      if (slug && set.has(slug)) this.cache.delete(id);
    }
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  private runtimeSignature(project: ProjectRow, config: ProjectConfig | null): string {
    return [
      project.slug,
      project.owner,
      project.repo,
      config?.github.tokenEnv ?? "GITHUB_TOKEN",
      JSON.stringify(config?.deployProviders ?? {}),
      config?.sandbox?.image ?? this.options.env.SANDBOX_IMAGE,
      config?.models?.developer ?? this.options.env.MODEL_DEVELOPER,
      config?.models?.fast ?? this.options.env.MODEL_FAST,
      this.options.fakes ? "fakes" : "live",
    ].join("|");
  }

  private buildRuntime(project: ProjectRow, config: ProjectConfig | null): Omit<ProjectRuntime, "project"> {
    const sandboxImage = config?.sandbox?.image ?? this.options.env.SANDBOX_IMAGE;
    const models = {
      developer: config?.models?.developer ?? this.options.env.MODEL_DEVELOPER,
      fast: config?.models?.fast ?? this.options.env.MODEL_FAST,
    };

    if (this.options.fakes) {
      const github = new FakeGitHubService(project.owner, project.repo);
      this.options.onFakeGitHub?.(github.cloneUrl(), github);
      const cfOrigin = config?.deployProviders.cloudflare?.origin ?? `https://${project.slug}-fe.stage.example`;
      const renderOrigin = config?.deployProviders.render?.origin ?? `https://${project.slug}-be.stage.example`;
      return {
        github,
        deployProviders: {
          CLOUDFLARE: new FakeDeployProvider(cfOrigin),
          RENDER: new FakeDeployProvider(renderOrigin),
        },
        sandboxImage,
        models,
      };
    }

    const tokenEnv = config?.github.tokenEnv ?? "GITHUB_TOKEN";
    const token = this.envLookup(tokenEnv);
    const github: GitHubService = token
      ? new OctokitGitHubService(token, project.owner, project.repo)
      : new UnconfiguredGitHubService(project.owner, project.repo, tokenEnv);

    const deployProviders: Partial<Record<Provider, DeployProvider>> = {};
    const render = config?.deployProviders.render;
    if (render) {
      const apiKey = this.envLookup(render.apiKeyEnv);
      if (apiKey) deployProviders.RENDER = new RenderDeployProvider(apiKey, render.serviceId, render.origin);
    }
    const cf = config?.deployProviders.cloudflare;
    if (cf) {
      const apiToken = this.envLookup(cf.apiTokenEnv);
      const accountId = this.envLookup(cf.accountIdEnv);
      if (apiToken && accountId) {
        deployProviders.CLOUDFLARE = new CloudflareDeployProvider(apiToken, accountId, cf.workerName, cf.origin);
      }
    }

    return { github, deployProviders, sandboxImage, models };
  }
}

export async function markProjectInactiveBySlug(slug: string): Promise<void> {
  await db.update(projects).set({ active: false }).where(eq(projects.slug, slug));
}
