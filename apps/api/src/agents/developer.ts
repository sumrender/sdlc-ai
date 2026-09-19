import type { ProjectManifest } from "@sdlc-ai/shared";
import type { TaskRow } from "../db/schema.js";
import { env } from "../env.js";
import { AgentOutputError, TimeoutError } from "../errors.js";
import { bus } from "../events/bus.js";
import { loadManifest } from "../integrations/manifest.js";
import { TIMEOUTS } from "../pipeline/deps.js";
import { tail, updateTask } from "../pipeline/tasks.js";
import { WORKSPACE } from "../sandbox/docker.js";
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

async function runChecks(ctx: RunContext, manifest: ProjectManifest): Promise<{ command: string; output: string } | null> {
  const { sandbox, log, task } = ctx;
  await bus.emit(task.id, "CHECKS_STARTED", { commands: manifest.checks });
  const deadline = Date.now() + TIMEOUTS.CHECKS;
  for (const command of manifest.checks) {
    log(`$ ${command}`);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new TimeoutError("Checks timed out after 10 minutes");
    const result = await sandbox.exec(command, { cwd: WORKSPACE, timeoutMs: remaining, onLine: log });
    if (result.timedOut) throw new TimeoutError("Checks timed out after 10 minutes");
    if (result.exitCode !== 0) {
      await bus.emit(task.id, "CHECKS_COMPLETED", { ok: false, command, exitCode: result.exitCode });
      return { command, output: tail(`${result.stdout}\n${result.stderr}`, 8000) };
    }
  }
  await bus.emit(task.id, "CHECKS_COMPLETED", { ok: true, commands: manifest.checks });
  return null;
}

function developerPrompt(task: TaskRow, manifest: ProjectManifest): string {
  const feedback = task.pendingFeedback
    ? `
# Feedback from the previous iteration
The previous attempt was rejected. Address every point below in addition to the plan:

${task.pendingFeedback}
`
    : "";
  const checks = manifest.checks.length ? manifest.checks.map((c) => `- \`${c}\``).join("\n") : "- (none)";
  return `# Task
Title: ${task.title}

${task.description || "(no description)"}

# Plan
${task.plan ?? "(no plan recorded)"}
${feedback}
# Checks
The control plane will run these commands after you finish; all of them must exit 0:
${checks}

# Rules
- Follow the Plan. You may change both frontend and backend code.
- Do not commit, push, or touch git configuration or anything under .opencode/.
- Run the Checks yourself before finishing and fix any failure.
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
