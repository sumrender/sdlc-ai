import { eq } from "drizzle-orm";
import type { Provider, TestConnectionInput } from "@sdlc-ai/shared";
import { secretCrypto } from "../crypto/secrets.js";
import { db } from "../db/index.js";
import { projectSecrets, type ProjectRow } from "../db/schema.js";
import type { Env } from "../env.js";
import { FakeDeployProvider, FakeGitHubService } from "../fakes/index.js";
import { requireProject } from "../pipeline/tasks.js";
import type { DeployProvider, GitHubService } from "../ports.js";
import { CloudflareDeployProvider } from "./cloudflare.js";
import { OctokitGitHubService } from "./github.js";
import { RenderDeployProvider } from "./render.js";

export interface ProjectRuntime {
  project: ProjectRow;
  secrets: Record<string, string>;
  github: GitHubService;
  deployProviders: Partial<Record<Provider, DeployProvider>>;
  sandboxImage: string;
  models: { developer: string; fast: string };
}

export interface ProjectRegistryOptions {
  fakes: boolean;
  env: Pick<Env, "SANDBOX_IMAGE" | "MODEL_DEVELOPER" | "MODEL_FAST">;
  resolveProject?: (idOrSlug: string) => Promise<ProjectRow>;
  loadSecrets?: (projectId: string) => Promise<Record<string, string>>;
  onFakeGitHub?: (cloneUrl: string, github: FakeGitHubService) => void;
}

class UnconfiguredGitHubService implements GitHubService {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
  ) {}

  private fail(): never {
    throw new Error(`Missing encrypted GITHUB_TOKEN secret for ${this.owner}/${this.repo}. Add it in Project Settings.`);
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
    return { ok: false, error: "GITHUB_TOKEN is not configured for this project. Add it in Project Settings." };
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

async function defaultLoadSecrets(projectId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ name: projectSecrets.name, ciphertext: projectSecrets.ciphertext })
    .from(projectSecrets)
    .where(eq(projectSecrets.projectId, projectId));
  const out: Record<string, string> = {};
  for (const row of rows) {
    out[row.name] = secretCrypto.decrypt(row.ciphertext);
  }
  return out;
}

export class ProjectRegistry {
  private readonly cache = new Map<string, { signature: string; runtime: Omit<ProjectRuntime, "project"> }>();
  private readonly resolveProject: (idOrSlug: string) => Promise<ProjectRow>;
  private readonly loadSecrets: (projectId: string) => Promise<Record<string, string>>;

  constructor(private readonly options: ProjectRegistryOptions) {
    this.resolveProject = options.resolveProject ?? requireProject;
    this.loadSecrets = options.loadSecrets ?? defaultLoadSecrets;
  }

  async forProject(idOrSlug: string): Promise<ProjectRuntime> {
    const project = await this.resolveProject(idOrSlug);
    const secrets = await this.loadSecrets(project.id);
    const signature = this.runtimeSignature(project, secrets);
    const cached = this.cache.get(project.id);
    if (cached && cached.signature === signature) {
      return { project, ...cached.runtime };
    }

    const runtime = this.buildRuntime(project, secrets);
    this.cache.set(project.id, { signature, runtime });
    return { project, ...runtime };
  }

  invalidateProject(projectId: string): void {
    this.cache.delete(projectId);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  async testGitHubConnection(input: TestConnectionInput): Promise<{ ok: boolean; login?: string; error?: string }> {
    if (this.options.fakes) {
      return { ok: true, login: "fake-bot" };
    }
    let token = input.token;
    if (!token && input.projectId) {
      const project = await this.resolveProject(input.projectId);
      const secrets = await this.loadSecrets(project.id);
      token = secrets.GITHUB_TOKEN;
    }
    if (!token) {
      return { ok: false, error: "Provide a GitHub token to test the connection." };
    }
    const gh = new OctokitGitHubService(token, input.owner, input.repo);
    return gh.connectionStatus();
  }

  private runtimeSignature(project: ProjectRow, secrets: Record<string, string>): string {
    const secretKeys = Object.keys(secrets).sort().map((k) => `${k}:${secrets[k]!.length}`);
    return [
      project.slug,
      project.owner,
      project.repo,
      project.configHash,
      project.updatedAt.toISOString(),
      JSON.stringify(project.deployProviders ?? {}),
      project.sandboxImage ?? this.options.env.SANDBOX_IMAGE,
      project.models?.developer ?? this.options.env.MODEL_DEVELOPER,
      project.models?.fast ?? this.options.env.MODEL_FAST,
      secretKeys.join(","),
      this.options.fakes ? "fakes" : "live",
    ].join("|");
  }

  private buildRuntime(project: ProjectRow, secrets: Record<string, string>): Omit<ProjectRuntime, "project"> {
    const sandboxImage = project.sandboxImage ?? this.options.env.SANDBOX_IMAGE;
    const models = {
      developer: project.models?.developer ?? this.options.env.MODEL_DEVELOPER,
      fast: project.models?.fast ?? this.options.env.MODEL_FAST,
    };

    if (this.options.fakes) {
      const github = new FakeGitHubService(project.owner, project.repo);
      this.options.onFakeGitHub?.(github.cloneUrl(), github);
      const cfOrigin = project.deployProviders.cloudflare?.origin ?? `https://${project.slug}-fe.stage.example`;
      const renderOrigin = project.deployProviders.render?.origin ?? `https://${project.slug}-be.stage.example`;
      return {
        secrets,
        github,
        deployProviders: {
          CLOUDFLARE: new FakeDeployProvider(cfOrigin),
          RENDER: new FakeDeployProvider(renderOrigin),
        },
        sandboxImage,
        models,
      };
    }

    const githubToken = secrets.GITHUB_TOKEN;
    const github: GitHubService = githubToken
      ? new OctokitGitHubService(githubToken, project.owner, project.repo)
      : new UnconfiguredGitHubService(project.owner, project.repo);

    const deployProviders: Partial<Record<Provider, DeployProvider>> = {};
    const render = project.deployProviders.render;
    if (render && secrets.RENDER_API_KEY) {
      deployProviders.RENDER = new RenderDeployProvider(secrets.RENDER_API_KEY, render.serviceId, render.origin);
    }
    const cf = project.deployProviders.cloudflare;
    if (cf && secrets.CF_API_TOKEN && secrets.CF_ACCOUNT_ID) {
      deployProviders.CLOUDFLARE = new CloudflareDeployProvider(secrets.CF_API_TOKEN, secrets.CF_ACCOUNT_ID, cf.workerName, cf.origin);
    }

    return { secrets, github, deployProviders, sandboxImage, models };
  }
}
