import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import type { ProjectManifest } from "@sdlc-ai/shared";
import {
  computeSetupHash,
  getConfigEpoch,
  getCurrentConfigHash,
  getSnapshot,
  hashManifest,
  loadLocalConfig,
  loadManifest,
  loadManifestForTask,
  reloadLocalConfig,
  resetConfigLoaderForTests,
  startConfigWatch,
} from "./config-loader.js";
import type { GitHubService } from "../ports.js";

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

const VALID_JS = `export default ${JSON.stringify({
  repository: { owner: "o", repo: "r", defaultBranch: "main" },
  root: { setup: MANIFEST_JSON.setup, checks: MANIFEST_JSON.checks },
  stacks: { frontend: MANIFEST_JSON.frontend, backend: MANIFEST_JSON.backend },
  e2e: null,
  version: 2,
})};`;

function fakeGithub(json: unknown, onCall?: () => void): GitHubService {
  return {
    async getFileContent() {
      onCall?.();
      return JSON.stringify(json);
    },
  } as unknown as GitHubService;
}

const throwingGithub = (): GitHubService =>
  ({
    async getFileContent() {
      throw new Error("github must not be called");
    },
  }) as unknown as GitHubService;

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

describe("config-loader (P1)", () => {
  it("loadLocalConfig returns {ok:false} on a missing file — never throws", async () => {
    process.env.SDLC_CONFIG_PATH = path.join(os.tmpdir(), "sdlc-config-does-not-exist-12345.mjs");
    const read = await loadLocalConfig();
    assert.equal(read.ok, false);
    assert.match((read as { error: string }).error, /not found|could not/i);
  });

  it("loadLocalConfig parses + validates a plain-JS config, hash is stable", async () => {
    process.env.SDLC_CONFIG_PATH = tmpConfigJs(VALID_JS);
    const first = await loadLocalConfig();
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.deepEqual(first.manifest.setup, ["pnpm install"]);
    assert.equal(first.source, "sdlc.config.ts");
    const second = await loadLocalConfig();
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(first.hash, second.hash);
    assert.equal(getConfigEpoch(), 1, "same content must not bump the epoch");
  });

  it("loadLocalConfig returns {ok:false} on validation failure", async () => {
    process.env.SDLC_CONFIG_PATH = tmpConfigJs(`export default { nope: true };`);
    const read = await loadLocalConfig();
    assert.equal(read.ok, false);
    assert.match((read as { error: string }).error, /validation/i);
  });

  it("loadLocalConfig unwraps one CJS-interop layer", async () => {
    // A .ts config under a CJS package.json arrives shaped as { default: X }.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-config-"));
    const file = path.join(dir, "sdlc.config.mjs");
    fs.writeFileSync(file, `export default { default: ${VALID_JS.replace(/^export default /, "").replace(/;\s*$/, "")} };`);
    process.env.SDLC_CONFIG_PATH = file;
    const read = await loadLocalConfig();
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.deepEqual(read.manifest.setup, ["pnpm install"]);
  });

  it("local is the only source: the repo is never touched", async () => {
    process.env.SDLC_CONFIG_PATH = tmpConfigJs(VALID_JS);
    const manifest = await loadManifest(throwingGithub(), "main");
    assert.deepEqual(manifest.setup, ["pnpm install"]);
  });

  it("invalid local throws; the repo is never read as a fallback", async () => {
    process.env.SDLC_CONFIG_PATH = tmpConfigJs(`export default { nope: true };`);
    let calls = 0;
    await assert.rejects(loadManifest(fakeGithub(MANIFEST_JSON, () => (calls += 1)), "main"), /validation/i);
    assert.equal(calls, 0);
  });

  it("valid local wins with no flag involved; the repo is never touched", async () => {
    process.env.SDLC_CONFIG_PATH = tmpConfigJs(VALID_JS);
    let calls = 0;
    const manifest = await loadManifest(fakeGithub(MANIFEST_JSON, () => (calls += 1)), "main");
    assert.deepEqual(manifest.setup, ["pnpm install"]);
    assert.equal(calls, 0);
  });

  it("reviewers share the task-pinned snapshot without any I/O", async () => {
    process.env.SDLC_CONFIG_PATH = tmpConfigJs(VALID_JS);
    const live = await loadManifest(throwingGithub(), "main");
    const hash = getCurrentConfigHash();
    assert.ok(hash);
    assert.deepEqual(getSnapshot(hash!), live);
    // Point at a missing file and break GitHub: the pinned read must still win.
    process.env.SDLC_CONFIG_PATH = path.join(os.tmpdir(), "sdlc-config-gone.mjs");
    const pinned = await loadManifestForTask(throwingGithub(), "main", { configHash: hash });
    assert.deepEqual(pinned, live);
    // Without a pin and without a local file there is no repo fallback: it throws.
    await assert.rejects(loadManifestForTask(throwingGithub(), "main", { configHash: null }), /not found|could not/i);
  });

  it("reload bumps the epoch only when content changes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-config-"));
    const file = path.join(dir, "sdlc.config.mjs");
    const write = (setup: string[]) =>
      fs.writeFileSync(
        file,
        `export default { repository: { owner: "o", repo: "r" }, root: { setup: ${JSON.stringify(setup)}, checks: [] }, stacks: {}, e2e: null };`,
      );
    process.env.SDLC_CONFIG_PATH = file;
    write(["a"]);
    const first = await reloadLocalConfig();
    assert.equal(first.ok, true);
    assert.equal(getConfigEpoch(), 1);
    const same = await reloadLocalConfig();
    assert.equal(same.ok, true);
    assert.equal(getConfigEpoch(), 1, "identical content must not bump the epoch");
    // mtime granularity: ensure the next write lands on a new tick.
    await new Promise((r) => setTimeout(r, 15));
    write(["b"]);
    const changed = await reloadLocalConfig();
    assert.equal(changed.ok, true);
    assert.equal(getConfigEpoch(), 2);
  });

  it("mtime watch fires onReload only on content change", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-config-"));
    const file = path.join(dir, "sdlc.config.mjs");
    fs.writeFileSync(file, `export default { repository: { owner: "o", repo: "r" }, root: { setup: ["a"], checks: [] }, stacks: {}, e2e: null };`);
    process.env.SDLC_CONFIG_PATH = file;
    await loadLocalConfig();
    const seen: string[] = [];
    const stop = startConfigWatch({ pollMs: 50, onReload: (info) => void seen.push(info.hash) });
    try {
      await new Promise((r) => setTimeout(r, 120));
      assert.deepEqual(seen, [], "no change yet");
      await new Promise((r) => setTimeout(r, 15));
      fs.writeFileSync(file, `export default { repository: { owner: "o", repo: "r" }, root: { setup: ["b"], checks: [] }, stacks: {}, e2e: null };`);
      const deadline = Date.now() + 3000;
      while (seen.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      assert.equal(seen.length, 1);
    } finally {
      stop();
    }
  });

  it("computeSetupHash mixes configHash + fullSetup + imageStamp", () => {
    const manifest = { setup: ["a"], checks: [], e2e: null } as ProjectManifest;
    const base = computeSetupHash(manifest, "hash1", "img1");
    assert.equal(computeSetupHash(manifest, "hash1", "img1"), base);
    assert.notEqual(computeSetupHash(manifest, "hash2", "img1"), base, "config change must invalidate setup cache");
    assert.notEqual(computeSetupHash(manifest, "hash1", "img2"), base, "image rebuild must invalidate setup cache");
    assert.notEqual(
      computeSetupHash({ setup: ["b"], checks: [], e2e: null } as ProjectManifest, "hash1", "img1"),
      base,
      "setup change must invalidate setup cache",
    );
    assert.equal(hashManifest(manifest), hashManifest({ setup: ["a"], checks: [], e2e: null } as ProjectManifest));
  });
});
