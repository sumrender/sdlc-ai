import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { E2eConfig } from "@sdlc-ai/shared";
import type { ExecOptions, ExecResult, Sandbox } from "../ports.js";

// See e2e-coverage.test.ts: the module graph reaches db/index.js, whose
// postgres client is lazy, so a well-formed URL is enough to import it.
process.env.DATABASE_URL ??= "postgres://sdlc:sdlc@127.0.0.1:5432/sdlc_test";
const { appendCliArg, forceVideoOn, withVideoDir } = await import("./e2e.js");

const e2eConfig = (overrides: Partial<E2eConfig> = {}): E2eConfig => ({
  command: "npm run test:e2e",
  cwd: "fe",
  testDir: "e2e",
  env: {},
  artifacts: ["fe/playwright-report", "fe/test-results"],
  optional: false,
  ...overrides,
});

// Minimal Sandbox stand-in: records writeFile calls and answers the config
// probe from a script. No Docker, no filesystem, no database.
class FakeSandbox implements Sandbox {
  readonly name = "fake";
  readonly writes: Array<{ path: string; content: string }> = [];
  readonly commands: string[] = [];
  constructor(private readonly configContent: string | null) {}

  async exec(command: string, _options: ExecOptions = {}): Promise<ExecResult> {
    this.commands.push(command);
    const stdout = command.startsWith("ls playwright.config.")
      ? this.configContent === null
        ? ""
        : "playwright.config.ts\n"
      : command.startsWith("cat ")
        ? (this.configContent ?? "")
        : "";
    return { exitCode: 0, stdout, stderr: "", timedOut: false };
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
  }
  async copyOut(): Promise<boolean> {
    return false;
  }
  async destroy(): Promise<void> {}
}

const CONFIG_WITHOUT_VIDEO = `export default { testDir: './e2e', use: { baseURL: 'http://localhost:4200', trace: 'on-first-retry', screenshot: 'only-on-failure' } };`;
const CONFIG_WITH_VIDEO_OFF = `export default { testDir: './e2e', use: { baseURL: 'http://localhost:4200', video: 'off' } };`;

describe("forceVideoOn", () => {
  it("writes an overlay that turns video fully on", async () => {
    const sandbox = new FakeSandbox(CONFIG_WITHOUT_VIDEO);
    const forced = await forceVideoOn(sandbox, e2eConfig(), "/workspace/fe", () => undefined);

    assert.equal(sandbox.writes.length, 1);
    const overlay = sandbox.writes[0]!;
    assert.equal(overlay.path, "/workspace/fe/sdlc-pw.config.ts");
    // The whole point of the function: not 'retain-on-failure', which deletes
    // every recording of a green suite.
    assert.match(overlay.content, /video: 'on'/);
    assert.doesNotMatch(overlay.content, /retain-on-failure/);
    assert.match(overlay.content, /screenshot: 'only-on-failure'/);
    // The overlay must extend the probed config and win the `use` merge.
    assert.match(overlay.content, /import base from '\.\/playwright\.config\.ts'/);
    assert.match(overlay.content, /\.\.\.\(b\?\.use \?\? \{\}\)/);
    assert.match(forced.command, /--config \S*sdlc-pw\.config\.ts/);
    assert.equal(typeof forced.cleanup, "function");
  });

  it("overrides a config that already declares video: a project cannot opt out", async () => {
    const sandbox = new FakeSandbox(CONFIG_WITH_VIDEO_OFF);
    const forced = await forceVideoOn(sandbox, e2eConfig(), "/workspace/fe", () => undefined);

    assert.equal(sandbox.writes.length, 1);
    assert.match(sandbox.writes[0]!.content, /video: 'on'/);
    assert.notEqual(forced.command, "npm run test:e2e");
  });

  it("leaves the command alone when no playwright config is found", async () => {
    const sandbox = new FakeSandbox(null);
    const logs: string[] = [];
    const forced = await forceVideoOn(sandbox, e2eConfig(), "/workspace/fe", (l) => logs.push(l));

    assert.equal(sandbox.writes.length, 0);
    assert.equal(forced.command, "npm run test:e2e");
    assert.equal(forced.cleanup, null);
    assert.ok(logs.some((l) => l.includes("could not be forced on")));
  });

  it("leaves a non-Playwright command alone", async () => {
    const sandbox = new FakeSandbox(CONFIG_WITHOUT_VIDEO);
    const forced = await forceVideoOn(sandbox, e2eConfig({ command: "make integration" }), "/workspace/fe", () => undefined);

    assert.equal(sandbox.writes.length, 0);
    assert.equal(forced.command, "make integration");
    assert.equal(forced.videoDir, null);
  });
});

describe("appendCliArg", () => {
  it("inserts the -- separator for package-manager run wrappers", () => {
    assert.equal(appendCliArg("npm run test:e2e", "--config x.ts"), "npm run test:e2e -- --config x.ts");
    assert.equal(appendCliArg("pnpm e2e", "--config x.ts"), "pnpm e2e -- --config x.ts");
  });

  it("does not add a second separator when the command already has one", () => {
    assert.equal(appendCliArg("npm run test:e2e -- --headed", "--config x.ts"), "npm run test:e2e -- --headed --config x.ts");
  });

  it("appends directly for direct binary invocations", () => {
    assert.equal(appendCliArg("npx playwright test", "--config x.ts"), "npx playwright test --config x.ts");
  });
});

describe("withVideoDir", () => {
  it("returns the manifest artifacts unchanged when there is no video dir", () => {
    const e2e = e2eConfig();
    assert.deepEqual(withVideoDir(e2e, null), e2e.artifacts);
  });

  it("does not duplicate a video dir the manifest already covers", () => {
    const e2e = e2eConfig();
    assert.deepEqual(withVideoDir(e2e, "fe/test-results"), e2e.artifacts);
  });

  it("appends an uncovered video dir", () => {
    const e2e = e2eConfig({ artifacts: ["fe/playwright-report"] });
    assert.deepEqual(withVideoDir(e2e, "fe/test-results"), ["fe/playwright-report", "fe/test-results"]);
  });
});
