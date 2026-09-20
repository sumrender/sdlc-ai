import { computeChangeScope, scopedChecks, scopedUnitTests, type ProjectManifest } from "@sdlc-ai/shared";
import type { TaskRow } from "../db/schema.js";
import { env } from "../env.js";
import { AgentOutputError, TimeoutError } from "../errors.js";
import { bus } from "../events/bus.js";
import { loadManifest } from "../integrations/manifest.js";
import { TIMEOUTS } from "../pipeline/deps.js";
import { tail, updateTask } from "../pipeline/tasks.js";
import { WORKSPACE } from "../sandbox/docker.js";
import { shellQuote } from "../sandbox/process.js";
import { commitAndPush, prepareWorkspace, prepareWorkspaceReuse } from "../sandbox/workspace.js";
import { AGENT_DEFINITIONS } from "./definitions.js";
import { invokeAgent, type AgentBody, type RunContext } from "./runner.js";

export const developerBody: AgentBody = async (ctx) => {
  const { deps, sandbox, log, task, project } = ctx;
  const branch = task.branchName;
  if (!branch) throw new AgentOutputError("Task has no branch name");

  const manifest = await loadManifest(deps.github, project.defaultBranch);
  const branchExists = await deps.github.branchExists(branch);
  const wsOptions = {
    ref: branchExists ? branch : project.defaultBranch,
    createBranch: branchExists ? undefined : branch,
    manifest,
    agents: ["DEVELOPER"] as const,
    log,
  };
  if ((project as { reuseSandbox?: boolean }).reuseSandbox) {
    await prepareWorkspaceReuse(sandbox, deps.github, { ...wsOptions, agents: [...wsOptions.agents] });
  } else {
    await prepareWorkspace(sandbox, deps.github, { ...wsOptions, agents: [...wsOptions.agents] });
  }

  let result = await invokeAgent(ctx, {
    agentName: AGENT_DEFINITIONS.DEVELOPER.name,
    prompt: developerPrompt(task, manifest),
    timeoutMs: TIMEOUTS.DEVELOPER,
    label: "Developer",
  });

  let failure = await runChecks(ctx, manifest);
  if (failure) {
    log(`Check failed: ${failure.command}. Handing back to the Developer for one fix iteration.`);
    result = await invokeAgent(ctx, {
      agentName: AGENT_DEFINITIONS.DEVELOPER.name,
      prompt: `The following Check failed after your changes. Fix the cause without disabling the check.\n\nCommand: ${failure.command}\n\nOutput:\n${failure.output}`,
      sessionId: result.sessionId,
      timeoutMs: TIMEOUTS.DEVELOPER,
      label: "Developer",
    });
    failure = await runChecks(ctx, manifest);
    if (failure) throw new AgentOutputError(`Checks still failing after the fix iteration: ${failure.command}`);
  }

  log("Committing and pushing as sdlc-ai[bot]");
  const { noChanges } = await commitAndPush(sandbox, deps.github, branch, task.title, log);
  if (noChanges && !task.pullRequestNumber) throw new AgentOutputError("Developer produced no changes to commit");

  await updateTask(task.id, { pendingFeedback: null });

  if (!task.pullRequestNumber) {
    const pr = await deps.github.createPullRequest({
      title: task.title,
      head: branch,
      base: project.defaultBranch,
      body: pullRequestBody(task),
    });
    await updateTask(task.id, { pullRequestNumber: pr.number, pullRequestUrl: pr.url });
    await bus.emit(task.id, "PR_CREATED", { number: pr.number, url: pr.url, branch });
    log(`Opened PR #${pr.number}: ${pr.url}`);
  }
};

interface CheckCommand {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

async function runChecks(ctx: RunContext, manifest: ProjectManifest): Promise<{ command: string; output: string } | null> {
  const { sandbox, log, task, project } = ctx;
  // Scope checks to the stacks the branch actually touches: fe-only changes
  // skip backend checks (and vice versa). Unknown or shared diffs run all.
  const changedFiles = await changedFilesInWorkspace(ctx).catch(() => [] as string[]);
  const scope = computeChangeScope(changedFiles, manifest);
  const scopeLabel = scope.shared ? "both stacks (shared changes)" : [scope.frontend && "frontend", scope.backend && "backend"].filter(Boolean).join(" + ");
  log(`Change scope: ${scopeLabel} (${changedFiles.length} changed file(s))`);

  const scopedChecksList = scopedChecks(manifest, scope).map((command) => ({ command, optional: false }));
  const scopedTests = scopedUnitTests(manifest, scope).map((u) => ({ command: u.command, cwd: u.cwd, env: u.env, optional: u.optional }));
  const commands: (CheckCommand & { optional: boolean })[] = [...scopedChecksList, ...scopedTests];
  await bus.emit(task.id, "CHECKS_STARTED", { commands: commands.map((c) => c.command), scope: scopeLabel });
  const deadline = Date.now() + TIMEOUTS.CHECKS;
  for (const { command, cwd, env, optional } of commands) {
    log(`$ ${command}${optional ? " (optional)" : ""}`);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new TimeoutError("Checks timed out after 10 minutes");
    const result = await sandbox.exec(command, { cwd: cwd && cwd !== "." ? `${WORKSPACE}/${cwd}` : WORKSPACE, env, timeoutMs: remaining, onLine: log });
    if (result.timedOut) throw new TimeoutError("Checks timed out after 10 minutes");
    if (result.exitCode !== 0) {
      const output = tail(`${result.stdout}\n${result.stderr}`, 8000);
      if (optional && isOptionalRunnerMissing(output)) {
        log(`[warn] Optional check "${command}" skipped (runner missing): ${output.slice(0, 300)}`);
        await bus.emit(task.id, "CHECKS_COMPLETED", { ok: true, command, skippedOptional: true });
        continue;
      }
      await bus.emit(task.id, "CHECKS_COMPLETED", { ok: false, command, exitCode: result.exitCode });
      return { command, output };
    }
  }
  await bus.emit(task.id, "CHECKS_COMPLETED", { ok: true, commands: commands.map((c) => c.command) });
  return null;
}

function isOptionalRunnerMissing(output: string): boolean {
  const lower = output.toLowerCase();
  // Karma / Chrome missing
  if (lower.includes("no binary for chromeheadless") || lower.includes('please, set "chrome_bin"') || lower.includes("cannot start chrome") || lower.includes("chromeheadless failed") || (lower.includes("launcher") && lower.includes("failed"))) return true;
  if (lower.includes("chrome not found") || lower.includes("chromium not found")) return true;
  // Karma config missing but optional
  if (lower.includes("karma") && lower.includes("not found")) return true;
  // dotnet / test runner missing
  if (lower.includes("dotnet: command not found") || lower.includes("no test is available") || lower.includes("no test matches")) return true;
  // Playwright missing browser
  if (lower.includes("browser not installed") || lower.includes("playwright test needs browsers")) return true;
  return false;
}

/** Files changed on the task branch vs the default branch, plus untracked files. Empty on any error (caller runs everything). */
async function changedFilesInWorkspace(ctx: RunContext): Promise<string[]> {
  const { sandbox, project } = ctx;
  const base = `origin/${project.defaultBranch}`;
  const out = new Set<string>();
  const diff = await sandbox.exec(`git diff --name-only ${shellQuote(base)}...HEAD; git diff --name-only`, { cwd: WORKSPACE });
  for (const line of diff.stdout.split("\n").map((s) => s.trim())) if (line) out.add(line);
  // Exclude control-plane injected files (.opencode/) like ensureCleanOrReset does,
  // otherwise every run looks "shared" and fe-only changes run backend checks too.
  const status = await sandbox.exec(`git status --porcelain -- . ':!.opencode'`, { cwd: WORKSPACE });
  for (const line of status.stdout.split("\n")) {
    const m = line.match(/^\?\?\s+(.+)$/);
    if (m?.[1]) out.add(m[1].trim().replace(/^"(.*)"$/, "$1"));
  }
  return [...out].filter((f) => f !== ".opencode" && !f.startsWith(".opencode/"));
}

function developerPrompt(task: TaskRow, manifest: ProjectManifest): string {
  const feedback = task.pendingFeedback
    ? `
# Feedback from the previous iteration
The previous attempt was rejected. Address every point below in addition to the plan:

${task.pendingFeedback}
`
    : "";
  const all: string[] = [
    ...manifest.checks,
    ...(manifest.frontend ? [...manifest.frontend.checks, ...(manifest.frontend.unitTests ? [manifest.frontend.unitTests.command] : [])] : []),
    ...(manifest.backend ? [...manifest.backend.checks, ...(manifest.backend.unitTests ? [manifest.backend.unitTests.command] : [])] : []),
  ];
  const checks = all.length ? all.map((c) => `- \`${c}\``).join("\n") : "- (none)";
  return `# Task
Title: ${task.title}

${task.description || "(no description)"}

# Plan
${task.plan ?? "(no plan recorded)"}
${feedback}
# Checks
The control plane will run the Checks for the stacks your branch touches after you finish; all of them must exit 0.
Changes touching only frontend paths skip backend checks, and vice versa. Shared files run everything.
The full set across both stacks:

${checks}

# Rules
- Follow the Plan. You may change both frontend and backend code.
- Do not commit, push, or touch git configuration or anything under .opencode/.
- Run the Checks for your touched stacks yourself before finishing and fix any failure.
- Finish with a short prose summary of what you changed.`;
}

function pullRequestBody(task: TaskRow): string {
  return `## Task
**${task.title}**

${task.description || "_No description._"}

## Plan
${task.plan ?? "_No plan recorded._"}

---
Control plane: ${env.CONTROL_PLANE_URL}/tasks/${task.id}
${task.issueNumber ? `\nCloses #${task.issueNumber}` : ""}`;
}
