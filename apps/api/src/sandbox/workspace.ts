import type { Agent, ProjectManifest } from "@sdlc-ai/shared";
import { AGENT_DEFINITIONS } from "../agents/definitions.js";
import { SandboxError, WorkspaceError } from "../errors.js";
import { TIMEOUTS } from "../pipeline/deps.js";
import type { GitHubService, Sandbox } from "../ports.js";
import { WORKSPACE } from "./docker.js";
import { shellQuote } from "./process.js";

export interface WorkspaceOptions {
  ref: string;
  createBranch?: string;
  manifest: ProjectManifest;
  agents: readonly Agent[];
  log: (line: string) => void;
}

// The token travels only as a per-invocation git config flag, never into .git/config or the filesystem.
export function gitWithAuth(github: GitHubService): string {
  return `git -c http.extraheader=${shellQuote(github.gitAuthHeader())}`;
}

export async function prepareWorkspace(sandbox: Sandbox, github: GitHubService, options: WorkspaceOptions): Promise<void> {
  options.log(`Cloning ${github.cloneUrl()} at ${options.ref}`);
  const clone = await sandbox.exec(
    `${gitWithAuth(github)} clone --quiet --branch ${shellQuote(options.ref)} ${shellQuote(github.cloneUrl())} ${WORKSPACE}`,
    { timeoutMs: TIMEOUTS.WORKSPACE, onLine: options.log },
  );
  if (clone.timedOut) throw new SandboxError("git clone timed out");
  if (clone.exitCode !== 0) throw new WorkspaceError(`git clone failed: ${clone.stderr.trim().slice(-2000)}`);

  if (options.createBranch) {
    const checkout = await sandbox.exec(`git checkout -q -b ${shellQuote(options.createBranch)}`, { cwd: WORKSPACE });
    if (checkout.exitCode !== 0) throw new WorkspaceError(`git checkout -b failed: ${checkout.stderr.trim()}`);
  }

  for (const command of options.manifest.setup) {
    options.log(`$ ${command}`);
    const result = await sandbox.exec(command, { cwd: WORKSPACE, timeoutMs: TIMEOUTS.WORKSPACE, onLine: options.log });
    if (result.timedOut) throw new WorkspaceError(`setup command timed out: ${command}`);
    if (result.exitCode !== 0) throw new WorkspaceError(`setup command failed (exit ${result.exitCode}): ${command}`);
  }

  for (const agent of options.agents) {
    const definition = AGENT_DEFINITIONS[agent];
    await sandbox.writeFile(`${WORKSPACE}/.opencode/agent/${definition.name}.md`, definition.content);
  }
}

// Removes injected agent files so they are never committed, then commits and pushes as the bot identity.
export function commitAndPushScript(github: GitHubService, branch: string, message: string): string {
  return [
    "set -e",
    "rm -f .opencode/agent/sdlc-*.md",
    "rmdir .opencode/agent 2>/dev/null || true",
    "rmdir .opencode 2>/dev/null || true",
    "git add -A",
    `if git diff --cached --quiet; then echo SDLC_NO_CHANGES; else git -c user.name='sdlc-ai[bot]' -c user.email='sdlc-ai@users.noreply.github.com' commit -q -m ${shellQuote(message)}; fi`,
    `${gitWithAuth(github)} push -q origin HEAD:refs/heads/${shellQuote(branch)}`,
    "echo SDLC_PUSHED $(git rev-parse HEAD)",
  ].join("\n");
}
