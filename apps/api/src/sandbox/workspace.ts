import type { Agent, ProjectManifest } from "@sdlc-ai/shared";
import { fullSetup } from "@sdlc-ai/shared";
import { AGENT_DEFINITIONS } from "../agents/definitions.js";
import { AgentOutputError, SandboxError, TimeoutError, WorkspaceError } from "../errors.js";
import { TIMEOUTS } from "../pipeline/deps.js";
import { tail } from "../pipeline/tasks.js";
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

  for (const command of fullSetup(options.manifest)) {
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

// Reuse path for `reuseSandbox`: keep the container, switch refs, skip setup
// when the manifest hash matches. Always rewrites the current agent files and
// resets to a clean git state (auto-reset + continue) before handing over.
// Setup is never scoped to a stack: workspaces prepare before the change set
// is known, and the Developer may touch both stacks.
const workspaceLocks = new Map<string, Promise<void>>();
async function withWorkspaceLock<T>(sandbox: Sandbox, fn: () => Promise<T>): Promise<T> {
  const key = sandbox.name;
  const prev = workspaceLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((res) => (release = res));
  workspaceLocks.set(key, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (workspaceLocks.get(key) === next) workspaceLocks.delete(key);
  }
}

export async function prepareWorkspaceReuse(sandbox: Sandbox, github: GitHubService, options: WorkspaceOptions): Promise<void> {
  return withWorkspaceLock(sandbox, async () => {
    const probe = await sandbox.exec(`test -d ${WORKSPACE}/.git && echo SDLC_HAS_GIT || echo SDLC_NO_GIT`, {});
    if (!probe.stdout.includes("SDLC_HAS_GIT")) {
      await prepareWorkspace(sandbox, github, options);
      await markSetupDone(sandbox, options.manifest);
      return;
    }

    options.log(`Reusing container workspace for ${options.ref}`);
    await ensureCleanOrReset(sandbox, options.log);
    const ga = gitWithAuth(github);
    const fetch = await sandbox.exec(`${ga} fetch --quiet origin`, { cwd: WORKSPACE, timeoutMs: TIMEOUTS.WORKSPACE });
    if (fetch.exitCode !== 0) throw new WorkspaceError(`git fetch failed: ${fetch.stderr.trim().slice(-1000)}`);

    if (options.createBranch) {
      const exists = await sandbox.exec(`git rev-parse --verify --quiet ${shellQuote(`refs/heads/${options.createBranch}`)}`, { cwd: WORKSPACE });
      if (exists.exitCode === 0) {
        const co = await sandbox.exec(`git checkout -q ${shellQuote(options.createBranch)} && git reset -q --hard HEAD`, { cwd: WORKSPACE });
        if (co.exitCode !== 0) throw new WorkspaceError(`git checkout failed: ${co.stderr.trim()}`);
      } else {
        // Branch does not exist locally: base it on the requested ref from origin.
        const co = await sandbox.exec(
          `git checkout -q -b ${shellQuote(options.createBranch)} ${shellQuote(`origin/${options.ref}`)} || git checkout -q -b ${shellQuote(options.createBranch)}`,
          { cwd: WORKSPACE },
        );
        if (co.exitCode !== 0) throw new WorkspaceError(`git checkout -b failed: ${co.stderr.trim()}`);
      }
    } else {
      const co = await sandbox.exec(`git checkout -q ${shellQuote(options.ref)} 2>/dev/null || git checkout -q origin/${shellQuote(options.ref)} -B ${shellQuote(options.ref)}`, {
        cwd: WORKSPACE,
      });
      if (co.exitCode !== 0) {
        const fallback = await sandbox.exec(`git checkout -q -B ${shellQuote(options.ref)} ${shellQuote(`origin/${options.ref}`)}`, { cwd: WORKSPACE });
        if (fallback.exitCode !== 0) throw new WorkspaceError(`git checkout failed: ${fallback.stderr.trim()}`);
      }
      const reset = await sandbox.exec(`git reset -q --hard ${shellQuote(`origin/${options.ref}`)}`, { cwd: WORKSPACE });
      if (reset.exitCode !== 0) throw new WorkspaceError(`git reset failed: ${reset.stderr.trim()}`);
    }

    if (await isSetupFresh(sandbox, options.manifest)) {
      options.log("Setup skipped (cached for this container)");
    } else {
      for (const command of fullSetup(options.manifest)) {
        options.log(`$ ${command}`);
        const result = await sandbox.exec(command, { cwd: WORKSPACE, timeoutMs: TIMEOUTS.WORKSPACE, onLine: options.log });
        if (result.timedOut) throw new WorkspaceError(`setup command timed out: ${command}`);
        if (result.exitCode !== 0) throw new WorkspaceError(`setup command failed (exit ${result.exitCode}): ${command}`);
      }
      await markSetupDone(sandbox, options.manifest);
    }

    for (const agent of options.agents) {
      const definition = AGENT_DEFINITIONS[agent];
      await sandbox.writeFile(`${WORKSPACE}/.opencode/agent/${definition.name}.md`, definition.content);
    }
  });
}

function setupHash(manifest: ProjectManifest): string {
  return JSON.stringify(fullSetup(manifest));
}

async function isSetupFresh(sandbox: Sandbox, manifest: ProjectManifest): Promise<boolean> {
  try {
    const r = await sandbox.exec(`cat /tmp/.sdlc-setup-hash 2>/dev/null || echo ""`, {});
    return r.stdout.trim() === setupHash(manifest) && r.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function markSetupDone(sandbox: Sandbox, manifest: ProjectManifest): Promise<void> {
  await sandbox.writeFile("/tmp/.sdlc-setup-hash", setupHash(manifest)).catch(() => undefined);
}

/**
 * Clean-guard: git-tracked files must be clean before switching agents.
 * Ignores .opencode/ (injected agent files) and overlay configs so they
 * are never deleted by the pre-switch reset. Agent files are stripped by
 * commitAndPushScript before commit so they are never pushed.
 */
export async function ensureCleanOrReset(sandbox: Sandbox, log: (line: string) => void): Promise<void> {
  // Check tracked files only; .opencode/ and overlay configs are injected per-run and intentionally dirty.
  const status = await sandbox.exec(`git status --porcelain -- . ':!.opencode'`, { cwd: WORKSPACE });
  if (status.exitCode !== 0) throw new WorkspaceError(`git status failed: ${status.stderr.trim()}`);
  if (!status.stdout.trim()) return;
  log(`Workspace not clean before switch; auto-resetting (${status.stdout.split("\n").filter(Boolean).length} file(s))`);
  // Remove stale overlay config (but never touch .opencode/ — agent files are per-run).
  await sandbox.exec(`rm -f /tmp/sdlc-pw.config.ts`, { cwd: WORKSPACE });
  const reset = await sandbox.exec(`git reset -q --hard HEAD && git clean -fdq -- . ':!.opencode'`, { cwd: WORKSPACE });
  if (reset.exitCode !== 0) throw new WorkspaceError(`workspace reset failed: ${reset.stderr.trim()}`);
  const recheck = await sandbox.exec(`git status --porcelain -- . ':!.opencode'`, { cwd: WORKSPACE });
  if (recheck.stdout.trim()) {
    throw new WorkspaceError(`workspace still dirty after reset: ${recheck.stdout.trim().slice(0, 1000)}`);
  }
  log("Workspace reset to clean");
}

// Shared commit+push used by the Developer and the E2E test writer.
// Returns the committed sha, or null when there was nothing to commit.
export async function commitAndPush(
  sandbox: Sandbox,
  github: GitHubService,
  branch: string,
  message: string,
  log: (line: string) => void,
  // When given (repo-relative), stage only these paths — the workspace is
  // shared/reused, so `git add -A` would commit unrelated stray files too.
  paths?: string[],
): Promise<{ pushed: boolean; noChanges: boolean }> {
  log("Committing and pushing as sdlc-ai[bot]");
  const commit = await sandbox.exec(commitAndPushScript(github, branch, message, paths), {
    cwd: WORKSPACE,
    timeoutMs: 5 * 60_000,
    onLine: (line) => {
      if (!line.includes("AUTHORIZATION")) log(line);
    },
  });
  if (commit.timedOut) throw new TimeoutError("commit/push timed out");
  if (commit.exitCode !== 0) throw new AgentOutputError(`commit/push failed: ${tail(commit.stderr, 2000)}`);
  const noChanges = commit.stdout.includes("SDLC_NO_CHANGES");
  if (noChanges) log("No new changes; branch already up to date");
  return { pushed: !noChanges, noChanges };
}

// Removes injected agent files so they are never committed, then commits and pushes as the bot identity.
export function commitAndPushScript(github: GitHubService, branch: string, message: string, paths?: string[]): string {
  const stage = paths && paths.length > 0 ? `git add -- ${paths.map(shellQuote).join(" ")}` : "git add -A";
  return [
    "set -e",
    "rm -f .opencode/agent/sdlc-*.md",
    "rmdir .opencode/agent 2>/dev/null || true",
    "rmdir .opencode 2>/dev/null || true",
    stage,
    `if git diff --cached --quiet; then echo SDLC_NO_CHANGES; else git -c user.name='sdlc-ai[bot]' -c user.email='sdlc-ai@users.noreply.github.com' commit -q -m ${shellQuote(message)}; fi`,
    `${gitWithAuth(github)} push -q origin HEAD:refs/heads/${shellQuote(branch)}`,
    "echo SDLC_PUSHED $(git rev-parse HEAD)",
  ].join("\n");
}
