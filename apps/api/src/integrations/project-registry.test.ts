import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProjectManifestSchema } from "@sdlc-ai/shared";
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
    manifest: ProjectManifestSchema.parse({ setup: ["npm ci"], checks: ["npm test"] }),
    deployTargets: [],
    deployProviders: { render: { serviceId: "srv-alpha", origin: "https://alpha.example" } },
    models: { developer: "alpha-dev", fast: "alpha-fast" },
    sandboxImage: "alpha-sandbox:v1",
    configHash: "hash-alpha",
    maxConcurrentTasks: 3,
    reuseSandbox: true,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  beta: {
    id: "22222222-2222-2222-2222-222222222222",
    slug: "beta",
    name: "Beta",
    owner: "org-b",
    repo: "beta-repo",
    defaultBranch: "develop",
    manifest: ProjectManifestSchema.parse({ setup: [], checks: [] }),
    deployTargets: [],
    deployProviders: { cloudflare: { workerName: "beta-worker", origin: "https://beta.example" } },
    models: null,
    sandboxImage: null,
    configHash: "hash-beta",
    maxConcurrentTasks: 2,
    reuseSandbox: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  },
};

describe("ProjectRegistry DB-backed multi-project isolation", () => {
  it("isolates GitHub credentials, secrets, deploy providers, images, and models per project", async () => {
    const projectSecretsById: Record<string, Record<string, string>> = {
      [PROJECTS.alpha!.id]: { GITHUB_TOKEN: "ghp_alpha", RENDER_API_KEY: "rnd_alpha" },
      [PROJECTS.beta!.id]: {
        // GITHUB_TOKEN intentionally omitted to verify UnconfiguredGitHubService fallback
        CF_API_TOKEN: "cf_beta",
        CF_ACCOUNT_ID: "acct_beta",
      },
    };

    const registry = new ProjectRegistry({
      fakes: false,
      env: { SANDBOX_IMAGE: "default-sandbox:local", MODEL_DEVELOPER: "default-dev", MODEL_FAST: "default-fast" },
      resolveProject: async (idOrSlug) => {
        const match = Object.values(PROJECTS).find((p) => p.id === idOrSlug || p.slug === idOrSlug);
        if (!match) throw new Error(`missing ${idOrSlug}`);
        return match;
      },
      loadSecrets: async (projectId) => projectSecretsById[projectId] ?? {},
    });

    const alpha = await registry.forProject("alpha");
    assert.equal(alpha.github.cloneUrl(), "https://github.com/org-a/alpha-repo.git");
    assert.equal(Boolean(alpha.deployProviders.RENDER), true);
    assert.equal(Boolean(alpha.deployProviders.CLOUDFLARE), false);
    assert.equal(alpha.sandboxImage, "alpha-sandbox:v1");
    assert.deepEqual(alpha.models, { developer: "alpha-dev", fast: "alpha-fast" });
    assert.equal(alpha.secrets.GITHUB_TOKEN, "ghp_alpha");

    const beta = await registry.forProject(PROJECTS.beta!.id);
    assert.equal(beta.github.cloneUrl(), "https://github.com/org-b/beta-repo.git");
    const betaStatus = await beta.github.connectionStatus();
    assert.equal(betaStatus.ok, false);
    assert.match(betaStatus.error ?? "", /GITHUB_TOKEN/);
    assert.equal(beta.secrets.GITHUB_TOKEN, undefined);
    assert.equal(Boolean(beta.deployProviders.CLOUDFLARE), true);
    assert.equal(Boolean(beta.deployProviders.RENDER), false);
    assert.equal(beta.sandboxImage, "default-sandbox:local");
    assert.deepEqual(beta.models, { developer: "default-dev", fast: "default-fast" });
  });

  it("tests ad-hoc or stored GitHub connections and supports cache invalidation", async () => {
    const registry = new ProjectRegistry({
      fakes: true,
      env: { SANDBOX_IMAGE: "default-sandbox:local", MODEL_DEVELOPER: "default-dev", MODEL_FAST: "default-fast" },
      resolveProject: async (idOrSlug) => {
        const match = Object.values(PROJECTS).find((p) => p.id === idOrSlug || p.slug === idOrSlug);
        if (!match) throw new Error(`missing ${idOrSlug}`);
        return match;
      },
      loadSecrets: async () => ({ GITHUB_TOKEN: "ghp_test" }),
    });

    const first = await registry.forProject("alpha");
    const second = await registry.forProject("alpha");
    assert.equal(first.github, second.github);

    registry.invalidateProject(PROJECTS.alpha!.id);
    const third = await registry.forProject("alpha");
    assert.notEqual(second.github, third.github);

    const conn = await registry.testGitHubConnection({ owner: "org-a", repo: "alpha-repo", token: "ghp_probe" });
    assert.equal(conn.ok, true);
  });
});
