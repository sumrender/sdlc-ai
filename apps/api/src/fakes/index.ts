import { randomBytes } from "node:crypto";
import { MANIFEST_PATH } from "@sdlc-ai/shared";
import type { DeployLookup, DeployProvider, ExecOptions, ExecResult, GitHubService, Sandbox, SandboxRunner } from "../ports.js";

// Scripted in-memory fakes so the whole pipeline can be driven over HTTP without Docker, GitHub or OpenCode Zen.

const FAKE_MANIFEST = JSON.stringify(
  {
    version: 2,
    setup: ["npm ci"],
    checks: [],
    frontend: {
      dir: "fe",
      paths: ["fe/**"],
      setup: ["npm ci --prefix fe"],
      checks: ["npm run build --prefix fe"],
      unitTests: { command: "npx ng test --watch=false --browsers=ChromeHeadless", cwd: "fe", optional: true },
      integrations: [{ name: "Playwright E2E", notes: "npm run test:e2e in fe; E2E_START_SERVER boots ng serve" }],
    },
    backend: {
      dir: "be",
      paths: ["be/**"],
      setup: [],
      checks: [],
      unitTests: null,
      integrations: [],
    },
    e2e: { command: "npm run test:e2e", cwd: "fe", env: { E2E_START_SERVER: "true" }, artifacts: ["fe/playwright-report", "fe/test-results"] },
  },
  null,
  2,
);

const FAKE_DIFF = `diff --git a/fe/src/components/GalleryHeader.tsx b/fe/src/components/GalleryHeader.tsx
--- a/fe/src/components/GalleryHeader.tsx
+++ b/fe/src/components/GalleryHeader.tsx
@@ -3,6 +3,7 @@ export function GalleryHeader({ templates }: Props) {
   return (
     <header>
       <h1>Templates</h1>
+      <span data-testid="template-count">{templates.length} templates</span>
     </header>
   );
 }`;

const fakeSha = () => randomBytes(20).toString("hex");
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FakeGitHubService implements GitHubService {
  readonly branches = new Set<string>();
  private issues = 0;
  private pulls = 100;
  readonly log: string[] = [];

  cloneUrl() {
    return "https://github.com/fake/meme.git";
  }
  gitAuthHeader() {
    return "AUTHORIZATION: basic ZmFrZTpmYWtl";
  }
  async createIssue(title: string) {
    const number = ++this.issues;
    this.log.push(`issue #${number}: ${title}`);
    return { number, url: `https://github.com/fake/meme/issues/${number}` };
  }
  async createPullRequest(input: { title: string; head: string }) {
    const number = ++this.pulls;
    this.branches.add(input.head);
    this.log.push(`pr #${number}: ${input.title}`);
    return { number, url: `https://github.com/fake/meme/pull/${number}` };
  }
  async getChangedFiles() {
    return (this as { changedFiles?: string[] }).changedFiles ?? ["fe/src/components/GalleryHeader.tsx", "fe/e2e/gallery.spec.ts"];
  }
  setChangedFiles(files: string[]) {
    (this as { changedFiles?: string[] }).changedFiles = files;
  }
  async squashMerge(pullNumber: number) {
    this.log.push(`merged pr #${pullNumber}`);
    return { sha: fakeSha() };
  }
  async deleteBranch(name: string) {
    this.branches.delete(name);
  }
  async branchExists(name: string) {
    return this.branches.has(name);
  }
  async closeIssue(number: number) {
    this.log.push(`closed issue #${number}`);
  }
  async closePullRequest(number: number) {
    this.log.push(`closed pr #${number}`);
  }
  async listBranches(prefix: string) {
    return [...this.branches].filter((b) => b.startsWith(prefix));
  }
  async getFileContent(path: string) {
    return path === MANIFEST_PATH ? FAKE_MANIFEST : null;
  }
  readonly comments: Array<{ id: number; body: string }> = [];
  readonly prBodies = new Map<number, string>();
  private commentSeq = 5000;
  async createComment(pullNumber: number, body: string) {
    const id = ++this.commentSeq;
    this.comments.push({ id, body });
    this.log.push(`comment on pr #${pullNumber}: ${body.slice(0, 80)}`);
    return { id, url: `https://github.com/fake/meme/pull/${pullNumber}#issuecomment-${id}` };
  }
  async listComments() {
    return [...this.comments];
  }
  async updateComment(commentId: number, body: string) {
    const c = this.comments.find((c) => c.id === commentId);
    if (c) c.body = body;
    this.log.push(`updated comment ${commentId}`);
  }
  async getPullRequestBody(pullNumber: number) {
    return this.prBodies.get(pullNumber) ?? `Fake PR body for #${pullNumber}`;
  }
  async updatePullRequestBody(pullNumber: number, body: string) {
    this.prBodies.set(pullNumber, body);
    this.log.push(`updated pr #${pullNumber} body`);
  }
  async uploadVideoAsset(fileName: string) {
    const url = `https://github.com/fake/meme/releases/download/sdlc-e2e-assets/${fileName}`;
    this.log.push(`uploaded video asset ${fileName}`);
    return { url, name: fileName };
  }
  async connectionStatus() {
    return { ok: true, login: "fake-bot" };
  }
}

export class FakeSandboxRunner implements SandboxRunner {
  constructor(private readonly github: FakeGitHubService) {}
  async create({ name }: { name: string }): Promise<Sandbox> {
    return new FakeSandbox(name, this.github);
  }
}

class FakeSandbox implements Sandbox {
  private cloned = false;
  private setupHash = "";
  constructor(
    readonly name: string,
    private readonly github: FakeGitHubService,
  ) {}

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    await delay(150);
    const ok = (stdout = ""): ExecResult => {
      for (const line of stdout.split("\n")) if (line) options.onLine?.(line, "stdout");
      return { exitCode: 0, stdout, stderr: "", timedOut: false };
    };

    if (command.includes("opencode run")) return ok(this.opencode(command, options.stdin ?? ""));
    if (command.includes("SDLC_PUSHED")) {
      const branch = command.match(/refs\/heads\/'([^']+)'/)?.[1];
      if (branch) this.github.branches.add(branch);
      return ok(`[${branch ?? "HEAD"}] ${fakeSha().slice(0, 7)} committed\nSDLC_PUSHED ${fakeSha()}`);
    }
    if (command.startsWith("git diff")) return ok(FAKE_DIFF);
    // E2E suite: emit a Playwright-style summary. The --config overlay flag is accepted and ignored.
    if (command.includes("test:e2e")) return ok("Running 3 tests using 1 worker\n\n  3 passed (2.1s)");
    if (command.startsWith("ls playwright") || command.startsWith("ls config/playwright")) return ok("playwright.config.ts");
    if (command.startsWith("cat playwright")) return ok("import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './e2e' });");
    if (command.startsWith("git status --porcelain") || command.startsWith("git diff --cached --name-only")) {
      return ok(this.name.includes("e2e") ? "fe/e2e/generated-coverage.spec.ts" : "");
    }
    if (command.includes("test -d") && command.includes(".git")) return ok(this.cloned ? "SDLC_HAS_GIT" : "SDLC_NO_GIT");
    if (command.startsWith("cat /tmp/.sdlc-setup-hash")) return ok(this.setupHash);
    if (command.startsWith("git clone")) {
      this.cloned = true;
      return ok("Cloning into '/workspace'...");
    }
    return ok();
  }

  private opencode(command: string, prompt: string): string {
    const agent = command.match(/--agent '?([^' ]+)'?/)?.[1] ?? "unknown";
    const sessionID = `ses_fake_${agent}`;
    let text: string;
    if (agent.includes("planner")) {
      const resumed = prompt.includes("The operator answered") || prompt.includes("Reply with ONLY");
      text = resumed
        ? 'Plan ready.\n\n```json\n{ "plan": "1. In fe/src/components/GalleryHeader.tsx render `{templates.length} templates` next to the title.\\n2. Add an E2E assertion in fe/e2e/gallery.spec.ts for data-testid=template-count.\\n3. Run `npm run build --prefix fe` and `npm run test:e2e`.", "question": null }\n```'
        : 'One thing to clarify before I plan.\n\n```json\n{ "plan": null, "question": { "text": "Should the count include hidden/unpublished templates?", "options": ["Only published templates", "All templates"] } }\n```';
    } else if (agent.includes("developer")) {
      text = "Implemented the template count in fe/src/components/GalleryHeader.tsx and added an E2E assertion in fe/e2e/gallery.spec.ts. Build passes.";
    } else if (agent.includes("e2e-test-writer")) {
      text = "Wrote a focused spec for the template count header.\n\nSPEC_PATH: fe/e2e/generated-coverage.spec.ts";
    } else if (agent.includes("frontend")) {
      text = 'Reviewed.\n\n```json\n{ "verdict": "REJECT", "findings": [ { "severity": "HIGH", "message": "templates.length is rendered without a null guard; a failed fetch renders a crash", "file": "fe/src/components/GalleryHeader.tsx", "line": 6 } ] }\n```';
    } else if (agent.includes("backend")) {
      text = 'Reviewed.\n\n```json\n{ "verdict": "PASS", "findings": [ { "severity": "LOW", "message": "No backend paths touched; nothing to flag", "file": "be/Controllers/TemplatesController.cs" } ] }\n```';
    } else {
      text = 'Reviewed.\n\n```json\n{ "verdict": "PASS", "findings": [ { "severity": "LOW", "message": "Consider extracting the count label for i18n", "file": "fe/src/components/GalleryHeader.tsx", "line": 6 } ] }\n```';
    }
    return [
      JSON.stringify({ type: "step-start", sessionID }),
      JSON.stringify({ type: "tool", sessionID, part: { id: "prt_tool", type: "tool", tool: "read", state: { status: "completed", title: "fe/src/components/GalleryHeader.tsx" } } }),
      JSON.stringify({ type: "text", sessionID, part: { id: "prt_text", type: "text", text } }),
      JSON.stringify({ type: "step-finish", sessionID }),
    ].join("\n");
  }

  async writeFile(path: string, content: string) {
    if (path === "/tmp/.sdlc-setup-hash") this.setupHash = content;
  }

  async copyOut(containerPath: string, hostDir: string) {
    // Materialize stub artifacts so importDir picks up a VIDEO + report.
    try {
      const { default: fs } = await import("node:fs/promises");
      const { default: path } = await import("node:path");
      await fs.mkdir(hostDir, { recursive: true });
      if (containerPath.includes("test-results")) {
        await fs.writeFile(path.join(hostDir, "generated-coverage-video.mp4"), "fake-mp4-bytes");
        return true;
      }
      if (containerPath.includes("playwright-report")) {
        await fs.writeFile(path.join(hostDir, "index.html"), "<html><body>Fake Playwright report</body></html>");
        return true;
      }
    } catch {
      // fall through to false
    }
    return false;
  }

  async destroy() {}
}

export class FakeDeployProvider implements DeployProvider {
  private readonly polls = new Map<string, number>();
  constructor(private readonly url: string) {}

  async getDeployment(commitSha: string): Promise<DeployLookup> {
    const n = (this.polls.get(commitSha) ?? 0) + 1;
    this.polls.set(commitSha, n);
    return { status: n < 2 ? "BUILDING" : "LIVE", url: this.url, providerRef: `fake-${commitSha.slice(0, 7)}` };
  }
}
