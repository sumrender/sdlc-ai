import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { tasks } from "../db/schema.js";
import { AgentOutputError } from "../errors.js";
import { bus } from "../events/bus.js";
import { loadManifest } from "../integrations/manifest.js";
import { TIMEOUTS } from "../pipeline/deps.js";
import { tail } from "../pipeline/tasks.js";
import { WORKSPACE } from "../sandbox/docker.js";
import { commitAndPush, prepareWorkspace } from "../sandbox/workspace.js";
import { AGENT_DEFINITIONS } from "./definitions.js";
import { invokeAgent, type AgentBody } from "./runner.js";

// One focused Playwright spec for the requested change, committed to the task
// branch. Verification is implicit: the next Test Run executes the new spec.
export const e2eTestWriterBody: AgentBody = async (ctx) => {
  const { deps, sandbox, log, task, project } = ctx;
  const branch = task.branchName;
  if (!branch) throw new AgentOutputError("Task has no branch name");

  const manifest = await loadManifest(deps.github, project.defaultBranch);
  await prepareWorkspace(sandbox, deps.github, { ref: branch, manifest, agents: ["E2E_TEST_WRITER"], log });

  const changedFiles = task.pullRequestNumber ? await deps.github.getChangedFiles(task.pullRequestNumber).catch(() => [] as string[]) : [];
  const result = await invokeAgent(ctx, {
    agentName: AGENT_DEFINITIONS.E2E_TEST_WRITER.name,
    prompt: e2eTestWriterPrompt(task.title, task.description, task.plan, changedFiles, manifest.e2e.cwd, manifest.e2e.command),
    timeoutMs: TIMEOUTS.DEVELOPER,
    label: "E2E_TEST_WRITER",
  });

  const specPath = detectSpecPath(result.text) ?? (await newestSpec(sandbox, manifest.e2e.cwd, log));
  const { noChanges } = await commitAndPush(sandbox, deps.github, branch, `Add E2E coverage for: ${task.title}`, log);
  if (noChanges && !specPath) throw new AgentOutputError("E2E test writer produced no spec to commit");

  const resolved = specPath ?? "e2e spec (path not reported)";
  await db.update(tasks).set({ e2eGeneratedSpecPath: specPath ?? tasks.e2eGeneratedSpecPath, updatedAt: new Date() }).where(eq(tasks.id, task.id));
  await bus.emit(task.id, "E2E_COVERAGE_DECIDED", { covered: false, generatedSpecPath: specPath ?? null, rationale: `Writer added ${resolved}` });
  log(`E2E spec ready: ${resolved}`);
};

function e2eTestWriterPrompt(title: string, description: string, plan: string | null, changedFiles: string[], cwd: string, command: string): string {
  return `# Task
Title: ${title}

${description || "(no description)"}

# Plan
${plan ?? "(no plan recorded)"}

# Changed files
${changedFiles.length ? changedFiles.map((f) => `- ${f}`).join("\n") : "- (unknown)"}

# E2E setup
- Spec directory: ${cwd}
- Suite command: ${command}

# Rules
- Write exactly one focused Playwright spec under ${cwd} covering the user-visible change above.
- Follow the repo's existing spec conventions (imports, fixtures, selectors).
- Keep titles unique and deterministic. No sleeps, no external network.
- Do NOT commit or push. End with a line: SPEC_PATH: <relative path of the spec you wrote>.`;
}

// The writer is instructed to end with "SPEC_PATH: <path>".
export function detectSpecPath(text: string): string | null {
  const match = text.match(/SPEC_PATH:\s*([^\s`'"]+\.spec\.[a-z]+|[^\s`'"]+\.e2e\.[a-z]+)/i);
  return match ? match[1]!.trim() : null;
}

async function newestSpec(sandbox: { exec: (cmd: string, opts?: { cwd?: string }) => Promise<{ stdout: string }> }, cwd: string, log: (l: string) => void): Promise<string | null> {
  try {
    const dir = cwd === "." ? WORKSPACE : `${WORKSPACE}/${cwd}`;
    const found = await sandbox.exec(
      `git status --porcelain | awk '{print $2}' | grep -E '\\.(spec|e2e)\\.[a-z]+$' | head -5; git diff --cached --name-only | grep -E '\\.(spec|e2e)\\.[a-z]+$' | head -5`,
      { cwd: dir },
    );
    const first = found.stdout.split("\n").map((s) => s.trim()).find(Boolean);
    return first ?? null;
  } catch (e) {
    log(`Could not detect new spec path: ${tail(String(e), 500)}`);
    return null;
  }
}
