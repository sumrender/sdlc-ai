import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { ProjectManifestSchema, type ProjectManifest } from "./manifest.js";
import {
  CreateProjectInputSchema,
  ProjectSlugSchema,
  UpdateProjectInputSchema,
  deployOverlapWarnings,
  hashManifest,
  resolveDeployTargetUrls,
  slugifyProject,
} from "./config.js";

const MANIFEST_JSON_URL = new URL("../../../.sdlc/manifest.json", import.meta.url);

function loadJsonManifest(): ProjectManifest {
  const raw = fs.readFileSync(MANIFEST_JSON_URL, "utf8");
  return ProjectManifestSchema.parse(JSON.parse(raw));
}

describe("ProjectSlugSchema & slugifyProject", () => {
  it("normalizes arbitrary names and avoids the reserved 'new' route segment", () => {
    assert.equal(slugifyProject("Meme Studio!"), "meme-studio");
    assert.equal(slugifyProject("SDLC_AI"), "sdlc-ai");
    assert.equal(slugifyProject("New"), "project-new");
    assert.equal(slugifyProject("___"), "project");
  });

  it("rejects reserved 'new' and non-kebab slugs", () => {
    assert.equal(ProjectSlugSchema.safeParse("new").success, false);
    assert.equal(ProjectSlugSchema.safeParse("Upper").success, false);
    assert.equal(ProjectSlugSchema.safeParse("my-project-1").success, true);
  });
});

describe("CreateProjectInputSchema & UpdateProjectInputSchema", () => {
  it("applies clean defaults when creating a minimal DB project", () => {
    const parsed = CreateProjectInputSchema.parse({
      repository: { owner: "sumrender", repo: "meme" },
    });
    assert.equal(parsed.repository.defaultBranch, "main");
    assert.deepEqual(parsed.manifest, { setup: [], checks: [], e2e: null });
    assert.deepEqual(parsed.deployTargets, []);
    assert.deepEqual(parsed.deployProviders, {});
    assert.equal(parsed.maxConcurrentTasks, 3);
    assert.equal(parsed.reuseSandbox, true);
  });

  it("validates secrets write map and nullable runtime overrides", () => {
    const update = UpdateProjectInputSchema.parse({
      models: null,
      sandboxImage: null,
      secrets: { GITHUB_TOKEN: "ghp_123456" },
    });
    assert.equal(update.models, null);
    assert.equal(update.sandboxImage, null);
    assert.equal(update.secrets?.GITHUB_TOKEN, "ghp_123456");

    const badSecretName = CreateProjectInputSchema.safeParse({
      repository: { owner: "o", repo: "r" },
      secrets: { "bad-key": "abc" },
    });
    assert.equal(badSecretName.success, false);
  });
});

describe("resolveDeployTargetUrls", () => {
  it("fills null target urls from matching provider origins while preserving explicit overrides", () => {
    const resolved = resolveDeployTargetUrls(
      [
        { target: "FE", provider: "CLOUDFLARE", pathPrefix: "fe/", url: null },
        { target: "BE", provider: "RENDER", pathPrefix: "be/", url: "https://be.fixed.example" },
      ],
      {
        cloudflare: { workerName: "demo-fe", origin: "https://fe.cfg.example" },
        render: { serviceId: "srv-123", origin: "https://be.cfg.example" },
      },
    );
    assert.deepEqual(resolved, [
      { target: "FE", provider: "CLOUDFLARE", pathPrefix: "fe/", url: "https://fe.cfg.example" },
      { target: "BE", provider: "RENDER", pathPrefix: "be/", url: "https://be.fixed.example" },
    ]);
  });
});

describe("hashManifest (shared, UI-safe)", () => {
  it("matches node:crypto sha256 on the canonical encoding", () => {
    const manifest = { setup: ["pnpm install"], checks: [], e2e: null } as ProjectManifest;
    const canonical = '{"checks":[],"e2e":null,"setup":["pnpm install"]}';
    assert.equal(hashManifest(manifest), createHash("sha256").update(canonical).digest("hex"));
  });

  it("agrees with node:crypto on a full manifest", () => {
    const sorted = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sorted);
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, sorted(v)]),
        );
      }
      return value;
    };
    const manifest = loadJsonManifest();
    const canonical = JSON.stringify(sorted(manifest));
    assert.equal(hashManifest(manifest), createHash("sha256").update(canonical).digest("hex"));
  });
});

describe("deployOverlapWarnings", () => {
  const manifest = ProjectManifestSchema.parse({
    setup: [],
    checks: [],
    frontend: { dir: "apps/web", paths: ["apps/web/**"] },
    backend: { dir: "apps/api", paths: ["apps/api/**"] },
    e2e: null,
  });
  const target = (pathPrefix: string) => ({ target: "FE" as const, provider: "CLOUDFLARE" as const, pathPrefix, url: null });

  it("is quiet when every prefix overlaps a stack", () => {
    assert.deepEqual(deployOverlapWarnings([target("apps/web/"), target("apps/api/**")], manifest), []);
  });

  it("warns per orphaned prefix, never throws", () => {
    const warnings = deployOverlapWarnings([target("fe/"), target("apps/web/")], manifest);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /FE.*fe\//);
  });
});
