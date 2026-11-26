import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { loadProjectRow } from "./project-row.js";

let savedPath: string | undefined;

beforeEach(() => {
  savedPath = process.env.SDLC_CONFIG_PATH;
  // Point at a file that cannot exist so the env fallback is exercised.
  process.env.SDLC_CONFIG_PATH = path.join(os.tmpdir(), "sdlc-config-does-not-exist-12345.mjs");
});

afterEach(() => {
  if (savedPath === undefined) delete process.env.SDLC_CONFIG_PATH;
  else process.env.SDLC_CONFIG_PATH = savedPath;
});

describe("loadProjectRow env fallback (no local config)", () => {
  it("builds the row from env without a local config file", async () => {
    const row = await loadProjectRow({
      GITHUB_OWNER: "o",
      GITHUB_REPO: "r",
      GITHUB_DEFAULT_BRANCH: "dev",
      FE_ORIGIN: "https://fe.example",
      BE_ORIGIN: null,
    });
    assert.deepEqual(row, {
      name: "r",
      owner: "o",
      repo: "r",
      defaultBranch: "dev",
      deployTargets: [
        { target: "FE", provider: "CLOUDFLARE", pathPrefix: "fe/", url: "https://fe.example" },
        { target: "BE", provider: "RENDER", pathPrefix: "be/", url: null },
      ],
    });
  });
});
