import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  ProjectManifestSchema,
  computeChangeScope,
  e2eSpecDir,
  fullSetup,
  scopedChecks,
  scopedUnitTests,
  type ChangeScope,
  type ProjectManifest,
} from "./manifest.js";
import { buildProjectRow, defineProject, deployOverlapWarnings, hashManifest, toProjectManifest } from "./config.js";

const MANIFEST_JSON_URL = new URL("../../../.sdlc/manifest.json", import.meta.url);

function loadJsonManifest(): ProjectManifest {
  const raw = fs.readFileSync(MANIFEST_JSON_URL, "utf8");
  return ProjectManifestSchema.parse(JSON.parse(raw));
}

function fromBuilder(manifest: ProjectManifest): ProjectManifest {
  const config = defineProject({
    version: manifest.version,
    repository: { owner: "sumrender", repo: "meme", defaultBranch: "main" },
    root: { setup: manifest.setup, checks: manifest.checks },
    stacks: { frontend: manifest.frontend, backend: manifest.backend },
    e2e: manifest.e2e,
  });
  return toProjectManifest(config);
}

const SCOPES: ChangeScope[] = [
  { frontend: true, backend: false, shared: false },
  { frontend: false, backend: true, shared: false },
  { frontend: true, backend: true, shared: true },
];

function underSpecDir(path: string, manifest: ProjectManifest): boolean | null {
  if (!manifest.e2e) return null;
  const specDir = e2eSpecDir(manifest.e2e).toLowerCase();
  return specDir !== "" && path.toLowerCase().startsWith(`${specDir}/`);
}

describe("config migration parity (.sdlc/manifest.json vs defineProject)", () => {
  it("produces an identical manifest", () => {
    assert.deepEqual(fromBuilder(loadJsonManifest()), loadJsonManifest());
  });

  it("keeps fullSetup identical", () => {
    const fromJson = loadJsonManifest();
    assert.deepEqual(fullSetup(fromBuilder(fromJson)), fullSetup(fromJson));
  });

  it("keeps scopedChecks/scopedUnitTests identical per scope", () => {
    const fromJson = loadJsonManifest();
    const viaBuilder = fromBuilder(fromJson);
    for (const scope of SCOPES) {
      assert.deepEqual(scopedChecks(viaBuilder, scope), scopedChecks(fromJson, scope), JSON.stringify(scope));
      assert.deepEqual(scopedUnitTests(viaBuilder, scope), scopedUnitTests(fromJson, scope), JSON.stringify(scope));
    }
  });

  it("keeps change-scope classification identical", () => {
    const fromJson = loadJsonManifest();
    const viaBuilder = fromBuilder(fromJson);
    const changedFiles = ["apps/web/src/app.ts", "apps/api/src/index.ts", "README.md", "packages/shared/src/manifest.ts"];
    assert.deepEqual(computeChangeScope(changedFiles, viaBuilder), computeChangeScope(changedFiles, fromJson));
  });

  it("keeps e2eSpecDir/isSpecLike identical when an e2e suite exists", () => {
    const withE2e = ProjectManifestSchema.parse({
      ...loadJsonManifest(),
      e2e: { command: "pnpm exec playwright test", cwd: "apps/web" },
    });
    const viaBuilder = fromBuilder(withE2e);
    assert.equal(e2eSpecDir(viaBuilder.e2e!), e2eSpecDir(withE2e.e2e!));
    // isSpecLike() depends on the manifest only via e2eSpecDir(); the spec
    // suffix list is manifest-independent. Prefix membership parity therefore
    // implies isSpecLike parity for every path.
    for (const path of ["apps/web/e2e/login.spec.ts", "apps/web/src/app.spec.ts", "apps/web/e2e/helpers/auth.ts"]) {
      assert.equal(underSpecDir(path, viaBuilder), underSpecDir(path, withE2e), path);
    }
  });
});

describe("defineProject defaults", () => {
  it("preserves every manifest .default()", () => {
    const config = defineProject({ repository: { owner: "o", repo: "r" } });
    assert.deepEqual(config.root.setup, []);
    assert.deepEqual(config.root.checks, []);
    assert.equal(config.e2e, null);
    assert.equal(config.stacks.frontend, undefined);
    assert.equal(config.stacks.backend, undefined);
    assert.deepEqual(config.deploy, []);
    assert.equal(config.repository.defaultBranch, "main");

    const withStacks = defineProject({
      repository: { owner: "o", repo: "r" },
      stacks: {
        frontend: { dir: "apps/web" },
        backend: { dir: "apps/api", unitTests: { command: "pnpm test" } },
      },
      e2e: { command: "pnpm exec playwright test" },
    });
    assert.deepEqual(withStacks.stacks.frontend!.paths, []);
    assert.deepEqual(withStacks.stacks.frontend!.setup, []);
    assert.deepEqual(withStacks.stacks.frontend!.checks, []);
    assert.equal(withStacks.stacks.frontend!.unitTests, null);
    assert.deepEqual(withStacks.stacks.frontend!.integrations, []);
    assert.equal(withStacks.stacks.backend!.unitTests!.cwd, ".");
    assert.equal(withStacks.e2e!.testDir, "e2e");
    assert.equal(withStacks.e2e!.cwd, ".");
    assert.equal(withStacks.sandbox, undefined);
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

describe("buildProjectRow", () => {
  it("maps repository + deploy, resolving null urls from env by target", () => {
    const config = defineProject({
      repository: { owner: "o", repo: "r", defaultBranch: "dev" },
      deploy: [
        { target: "FE", provider: "CLOUDFLARE", pathPrefix: "fe/", url: null },
        { target: "BE", provider: "RENDER", pathPrefix: "be/", url: "https://be.fixed.example" },
      ],
    });
    assert.deepEqual(buildProjectRow(config, { FE_ORIGIN: "https://fe.env.example" }), {
      name: "r",
      owner: "o",
      repo: "r",
      defaultBranch: "dev",
      deployTargets: [
        { target: "FE", provider: "CLOUDFLARE", pathPrefix: "fe/", url: "https://fe.env.example" },
        { target: "BE", provider: "RENDER", pathPrefix: "be/", url: "https://be.fixed.example" },
      ],
    });
    assert.deepEqual(buildProjectRow(config).deployTargets[0]?.url, null);
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
