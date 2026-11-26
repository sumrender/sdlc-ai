import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import type { ProjectManifest } from "@sdlc-ai/shared";
import {
  computeSetupHash,
  getProjectConfigEpoch,
  getProjectConfigHash,
  hashManifest,
  loadLocalProjectsConfig,
  loadManifestForSlug,
  loadManifestForTask,
  reloadLocalProjectsConfig,
  resetConfigLoaderForTests,
  startConfigWatch,
} from "./config-loader.js";

const MANIFEST_JSON = {
  version: 2,
  setup: ["pnpm install"],
  checks: ["pnpm -r typecheck"],
  frontend: { dir: "apps/web", paths: ["apps/web/**"], setup: [], checks: ["build-fe"], unitTests: null, integrations: [] },
  backend: { dir: "apps/api", paths: ["apps/api/**"], setup: [], checks: ["build-be"], unitTests: null, integrations: [] },
  e2e: null,
};

function tmpConfigJs(contents: string, ext = ".mjs"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-config-"));
  const file = path.join(dir, `sdlc.config${ext}`);
  fs.writeFileSync(file, contents);
  return file;
}

const VALID_PROJECTS = [
  {
    slug: "alpha",
    repository: { owner: "o", repo: "alpha", defaultBranch: "main" },
    root: { setup: MANIFEST_JSON.setup, checks: MANIFEST_JSON.checks },
    stacks: { frontend: MANIFEST_JSON.frontend, backend: MANIFEST_JSON.backend },
    e2e: null,
    version: 2,
  },
  {
    slug: "beta",
    repository: { owner: "o", repo: "beta", defaultBranch: "main" },
    root: { setup: ["npm ci"], checks: ["npm test"] },
    stacks: {},
    e2e: null,
    version: 2,
  },
];

const VALID_JS = `export default ${JSON.stringify(VALID_PROJECTS)};`;

let savedPath: string | undefined;

beforeEach(() => {
  savedPath = process.env.SDLC_CONFIG_PATH;
  delete process.env.SDLC_CONFIG_PATH;
  resetConfigLoaderForTests();
});

afterEach(() => {
  if (savedPath === undefined) delete process.env.SDLC_CONFIG_PATH;
  else process.env.SDLC_CONFIG_PATH = savedPath;
  resetConfigLoaderForTests();
});

describe("multi-project config-loader", () => {
  it("loadLocalProjectsConfig returns {ok:false} on a missing file — never throws", async () => {
    process.env.SDLC_CONFIG_PATH = path.join(os.tmpdir(), "sdlc-config-does-not-exist-12345.mjs");
    const read = await loadLocalProjectsConfig();
    assert.equal(read.ok, false);
    assert.match((read as { error: string }).error, /not found|could not/i);
  });

  it("parses multiple projects with stable hashes and independent epochs", async () => {
    process.env.SDLC_CONFIG_PATH = tmpConfigJs(VALID_JS);
    const first = await loadLocalProjectsConfig();
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.list.length, 2);
    assert.deepEqual(first.changedSlugs.sort(), ["alpha", "beta"]);
    assert.deepEqual(first.projects.get("alpha")?.manifest.setup, ["pnpm install"]);
    assert.deepEqual(first.projects.get("beta")?.manifest.setup, ["npm ci"]);

    const second = await loadLocalProjectsConfig();
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.deepEqual(second.changedSlugs, []);
    assert.equal(getProjectConfigEpoch("alpha"), 1);
    assert.equal(getProjectConfigEpoch("beta"), 1);
  });

  it("returns {ok:false} on validation failure or duplicate slugs", async () => {
    process.env.SDLC_CONFIG_PATH = tmpConfigJs(`export default [{ nope: true }];`);
    const invalid = await loadLocalProjectsConfig();
    assert.equal(invalid.ok, false);
    assert.match((invalid as { error: string }).error, /validation/i);

    process.env.SDLC_CONFIG_PATH = tmpConfigJs(
      `export default ${JSON.stringify([
        { slug: "dup", repository: { owner: "o", repo: "a" } },
        { slug: "dup", repository: { owner: "o", repo: "b" } },
      ])};`,
    );
    const dup = await loadLocalProjectsConfig();
    assert.equal(dup.ok, false);
    assert.match((dup as { error: string }).error, /Duplicate project slug/i);
  });

  it("unwraps one CJS-interop layer", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-config-"));
    const file = path.join(dir, "sdlc.config.mjs");
    fs.writeFileSync(file, `export default { default: ${JSON.stringify(VALID_PROJECTS)} };`);
    process.env.SDLC_CONFIG_PATH = file;
    const read = await loadLocalProjectsConfig();
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.list.length, 2);
  });

  it("reviewers share the task-pinned snapshot per slug without disk I/O", async () => {
    process.env.SDLC_CONFIG_PATH = tmpConfigJs(VALID_JS);
    const live = await loadManifestForSlug("alpha");
    const hash = getProjectConfigHash("alpha");
    assert.ok(hash);
    process.env.SDLC_CONFIG_PATH = path.join(os.tmpdir(), "sdlc-config-gone.mjs");
    const pinned = await loadManifestForTask("alpha", { configHash: hash });
    assert.deepEqual(pinned, live);
    await assert.rejects(loadManifestForTask("alpha", { configHash: null }), /not found|could not/i);
  });

  it("reload bumps epoch and reports changedSlugs only for projects that changed", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-config-"));
    const file = path.join(dir, "sdlc.config.mjs");
    const write = (setupAlpha: string[], setupBeta: string[]) =>
      fs.writeFileSync(
        file,
        `export default ${JSON.stringify([
          { slug: "alpha", repository: { owner: "o", repo: "a" }, root: { setup: setupAlpha, checks: [] } },
          { slug: "beta", repository: { owner: "o", repo: "b" }, root: { setup: setupBeta, checks: [] } },
        ])};`,
      );
    process.env.SDLC_CONFIG_PATH = file;
    write(["a1"], ["b1"]);
    const first = await reloadLocalProjectsConfig();
    assert.equal(first.ok, true);
    assert.equal(getProjectConfigEpoch("alpha"), 1);
    assert.equal(getProjectConfigEpoch("beta"), 1);

    const same = await reloadLocalProjectsConfig();
    assert.equal(same.ok, true);
    if (same.ok) assert.deepEqual(same.changedSlugs, []);
    assert.equal(getProjectConfigEpoch("alpha"), 1);
    assert.equal(getProjectConfigEpoch("beta"), 1);

    await new Promise((r) => setTimeout(r, 15));
    write(["a2"], ["b1"]);
    const changed = await reloadLocalProjectsConfig();
    assert.equal(changed.ok, true);
    if (changed.ok) assert.deepEqual(changed.changedSlugs, ["alpha"]);
    assert.equal(getProjectConfigEpoch("alpha"), 2);
    assert.equal(getProjectConfigEpoch("beta"), 1, "unchanged project must keep its epoch");
  });

  it("mtime watch fires onReload with changedSlugs only on content change", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-config-"));
    const file = path.join(dir, "sdlc.config.mjs");
    fs.writeFileSync(file, `export default ${JSON.stringify([{ slug: "alpha", repository: { owner: "o", repo: "a" }, root: { setup: ["a"], checks: [] } }])};`);
    process.env.SDLC_CONFIG_PATH = file;
    await loadLocalProjectsConfig();
    const seen: string[][] = [];
    const stop = startConfigWatch({ pollMs: 50, onReload: (changedSlugs) => void seen.push(changedSlugs) });
    try {
      await new Promise((r) => setTimeout(r, 120));
      assert.deepEqual(seen, [], "no change yet");
      await new Promise((r) => setTimeout(r, 15));
      fs.writeFileSync(file, `export default ${JSON.stringify([{ slug: "alpha", repository: { owner: "o", repo: "a" }, root: { setup: ["b"], checks: [] } }])};`);
      const deadline = Date.now() + 3000;
      while (seen.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(seen, [["alpha"]]);
    } finally {
      stop();
    }
  });

  it("computeSetupHash mixes configHash + fullSetup + imageStamp", () => {
    const manifest = { setup: ["a"], checks: [], e2e: null } as ProjectManifest;
    const base = computeSetupHash(manifest, "hash1", "img1");
    assert.equal(computeSetupHash(manifest, "hash1", "img1"), base);
    assert.notEqual(computeSetupHash(manifest, "hash2", "img1"), base);
    assert.notEqual(computeSetupHash(manifest, "hash1", "img2"), base);
    assert.equal(hashManifest(manifest), hashManifest({ setup: ["a"], checks: [], e2e: null } as ProjectManifest));
  });
});
