import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineProjects } from "@sdlc-ai/shared";
import type { ProjectRow } from "../db/schema.js";

process.env.DATABASE_URL ??= "postgres://sdlc:sdlc@127.0.0.1:5432/sdlc_test";
const { ProjectRegistry } = await import("./project-registry.js");

const now = new Date("2026-01-01T00:00:00.000Z");

const PROJECTS: Record<string, ProjectRow> = {
  alpha: {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "alpha",
    name: "Alpha",
    owner: "org-a",
    repo: "alpha-repo",
    defaultBranch: "main",
    deployTargets: [],
    maxConcurrentTasks: 3,
    reuseSandbox: true,
    active: true,
    createdAt: now,
  },
  beta: {
    id: "22222222-2222-2222-2222-222222222222",
    slug: "beta",
    name: "Beta",
    owner: "org-b",
    repo: "beta-repo",
    defaultBranch: "develop",
    deployTargets: [],
    maxConcurrentTasks: 2,
    reuseSandbox: false,
    active: true,
    createdAt: now,
  },
};

const CONFIGS = defineProjects([
  {
    slug: "alpha",
    repository: { owner: "org-a", repo: "alpha-repo", defaultBranch: "main" },
    github: { tokenEnv: "GH_ALPHA_TOKEN" },
    deployProviders: {
      render: { serviceId: "srv-alpha", apiKeyEnv: "RENDER_ALPHA_KEY", origin: "https://alpha.example" },
    },
    sandbox: { image: "alpha-sandbox:v1", reuse: true },
    models: { developer: "alpha-dev", fast: "alpha-fast" },
  },
  {
    slug: "beta",
    repository: { owner: "org-b", repo: "beta-repo", defaultBranch: "develop" },
    github: { tokenEnv: "GH_BETA_TOKEN" },
    deployProviders: {
      cloudflare: { workerName: "beta-worker", apiTokenEnv: "CF_BETA_TOKEN", accountIdEnv: "CF_BETA_ACCT", origin: "https://beta.example" },
    },
  },
]);

describe("ProjectRegistry per-project runtime isolation", () => {
  it("resolves distinct GitHub repos, deploy providers, images, and models per project", async () => {
    const envVars: Record<string, string> = {
      GH_ALPHA_TOKEN: "ghp_alpha",
      RENDER_ALPHA_KEY: "rnd_alpha",
      CF_BETA_TOKEN: "cf_beta",
      CF_BETA_ACCT: "acct_beta",
      // GH_BETA_TOKEN intentionally omitted to verify unconfigured fallback
    };

    const registry = new ProjectRegistry({
      fakes: false,
      env: { SANDBOX_IMAGE: "default-sandbox:local", MODEL_DEVELOPER: "default-dev", MODEL_FAST: "default-fast" },
      resolveProject: async (idOrSlug) => {
        const match = Object.values(PROJECTS).find((p) => p.id === idOrSlug || p.slug === idOrSlug);
        if (!match) throw new Error(`missing ${idOrSlug}`);
        return match;
      },
      envLookup: (name) => envVars[name],
      getConfig: (slug) => CONFIGS.find((c) => c.slug === slug) ?? null,
    });

    const alpha = await registry.forProject("alpha");
    assert.equal(alpha.github.cloneUrl(), "https://github.com/org-a/alpha-repo.git");
    assert.equal(Boolean(alpha.deployProviders.RENDER), true);
    assert.equal(Boolean(alpha.deployProviders.CLOUDFLARE), false);
    assert.equal(alpha.sandboxImage, "alpha-sandbox:v1");
    assert.deepEqual(alpha.models, { developer: "alpha-dev", fast: "alpha-fast" });

    const beta = await registry.forProject(PROJECTS.beta!.id);
    assert.equal(beta.github.cloneUrl(), "https://github.com/org-b/beta-repo.git");
    const betaStatus = await beta.github.connectionStatus();
    assert.equal(betaStatus.ok, false);
    assert.match(betaStatus.error ?? "", /GH_BETA_TOKEN/);
    assert.equal(Boolean(beta.deployProviders.CLOUDFLARE), true);
    assert.equal(Boolean(beta.deployProviders.RENDER), false);
    assert.equal(beta.sandboxImage, "default-sandbox:local");
    assert.deepEqual(beta.models, { developer: "default-dev", fast: "default-fast" });
  });

  it("registers distinct FakeGitHubService instances per project in fakes mode", async () => {
    const fakeUrls: string[] = [];
    const registry = new ProjectRegistry({
      fakes: true,
      env: { SANDBOX_IMAGE: "default-sandbox:local", MODEL_DEVELOPER: "default-dev", MODEL_FAST: "default-fast" },
      resolveProject: async (idOrSlug) => Object.values(PROJECTS).find((p) => p.id === idOrSlug || p.slug === idOrSlug)!,
      getConfig: (slug) => CONFIGS.find((c) => c.slug === slug) ?? null,
      onFakeGitHub: (url) => fakeUrls.push(url),
    });

    const alpha = await registry.forProject("alpha");
    const beta = await registry.forProject("beta");
    assert.notEqual(alpha.github, beta.github);
    assert.deepEqual(fakeUrls, [
      "https://github.com/org-a/alpha-repo.git",
      "https://github.com/org-b/beta-repo.git",
    ]);

    // Selective invalidation leaves beta cached and rebuilds alpha.
    registry.invalidateBySlugs(["alpha"]);
    const alpha2 = await registry.forProject("alpha");
    const beta2 = await registry.forProject("beta");
    assert.notEqual(alpha2.github, alpha.github);
    assert.equal(beta2.github, beta.github);
  });
});
