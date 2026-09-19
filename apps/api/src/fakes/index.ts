import { randomBytes } from "node:crypto";
import { MANIFEST_PATH } from "@sdlc-ai/shared";
import type { DeployLookup, DeployProvider, ExecOptions, ExecResult, GitHubService, Sandbox, SandboxRunner } from "../ports.js";

// Scripted in-memory fakes so the whole pipeline can be driven over HTTP without Docker, GitHub or Anthropic.

const FAKE_MANIFEST = JSON.stringify(
  {
    setup: ["npm ci", "npm ci --prefix fe"],
    checks: ["npm run build --prefix fe"],
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
    return ["fe/src/components/GalleryHeader.tsx", "fe/e2e/gallery.spec.ts"];
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
    if (command.includes("test:e2e")) return ok("Running 3 tests using 1 worker\n\n  3 passed (2.1s)");
    if (command.startsWith("git clone")) return ok("Cloning into '/workspace'...");
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
    } else if (agent.includes("security")) {
      text = 'Reviewed.\n\n```json\n{ "verdict": "REJECT", "findings": [ { "severity": "HIGH", "message": "templates.length is rendered without a null guard; a failed fetch renders a crash", "file": "fe/src/components/GalleryHeader.tsx", "line": 6 } ] }\n```';
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

  async writeFile() {}

  async copyOut() {
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
