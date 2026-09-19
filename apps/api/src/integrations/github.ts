import { Octokit } from "octokit";
import type { GitHubService } from "../ports.js";

export class OctokitGitHubService implements GitHubService {
  private readonly octokit: Octokit;

  constructor(
    private readonly token: string,
    private readonly owner: string,
    private readonly repo: string,
  ) {
    this.octokit = new Octokit({ auth: token });
  }

  private get base() {
    return { owner: this.owner, repo: this.repo };
  }

  cloneUrl(): string {
    return `https://github.com/${this.owner}/${this.repo}.git`;
  }

  gitAuthHeader(): string {
    const basic = Buffer.from(`x-access-token:${this.token}`).toString("base64");
    return `AUTHORIZATION: basic ${basic}`;
  }

  async createIssue(title: string, body: string) {
    const { data } = await this.octokit.rest.issues.create({ ...this.base, title, body });
    return { number: data.number, url: data.html_url };
  }

  async createPullRequest(input: { title: string; head: string; base: string; body: string }) {
    const { data } = await this.octokit.rest.pulls.create({ ...this.base, ...input });
    return { number: data.number, url: data.html_url };
  }

  async getChangedFiles(pullNumber: number): Promise<string[]> {
    const files = await this.octokit.paginate(this.octokit.rest.pulls.listFiles, {
      ...this.base,
      pull_number: pullNumber,
      per_page: 100,
    });
    return files.map((f) => f.filename);
  }

  async squashMerge(pullNumber: number, commitTitle: string) {
    const { data } = await this.octokit.rest.pulls.merge({
      ...this.base,
      pull_number: pullNumber,
      merge_method: "squash",
      commit_title: commitTitle,
    });
    if (!data.merged || !data.sha) throw new Error(`merge of #${pullNumber} not completed: ${data.message}`);
    return { sha: data.sha };
  }

  async deleteBranch(name: string) {
    await this.octokit.rest.git.deleteRef({ ...this.base, ref: `heads/${name}` }).catch((e: { status?: number }) => {
      if (e.status !== 422 && e.status !== 404) throw e;
    });
  }

  async branchExists(name: string) {
    try {
      await this.octokit.rest.repos.getBranch({ ...this.base, branch: name });
      return true;
    } catch (e) {
      if ((e as { status?: number }).status === 404) return false;
      throw e;
    }
  }

  async closeIssue(number: number) {
    await this.octokit.rest.issues.update({ ...this.base, issue_number: number, state: "closed" });
  }

  async closePullRequest(number: number) {
    await this.octokit.rest.pulls.update({ ...this.base, pull_number: number, state: "closed" });
  }

  async listBranches(prefix: string) {
    const branches = await this.octokit.paginate(this.octokit.rest.repos.listBranches, { ...this.base, per_page: 100 });
    return branches.map((b) => b.name).filter((n) => n.startsWith(prefix));
  }

  async getFileContent(path: string, ref: string) {
    try {
      const { data } = await this.octokit.rest.repos.getContent({ ...this.base, path, ref });
      if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
      return Buffer.from(data.content, "base64").toString("utf8");
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }

  async connectionStatus() {
    try {
      const { data } = await this.octokit.rest.users.getAuthenticated();
      await this.octokit.rest.repos.get(this.base);
      return { ok: true, login: data.login };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
