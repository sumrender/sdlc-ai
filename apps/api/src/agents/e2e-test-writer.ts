import { eq } from "drizzle-orm";
import { e2eSpecDir } from "@sdlc-ai/shared";
import { db } from "../db/index.js";
import { tasks } from "../db/schema.js";
import { AgentOutputError } from "../errors.js";
import { bus } from "../events/bus.js";
import { loadManifest } from "../integrations/manifest.js";
import { TIMEOUTS } from "../pipeline/deps.js";
import { tail } from "../pipeline/tasks.js";
import { WORKSPACE } from "../sandbox/docker.js";
import { shellQuote } from "../sandbox/process.js";
import { commitAndPush, prepareWorkspace, prepareWorkspaceReuse } from "../sandbox/workspace.js";
import { AGENT_DEFINITIONS } from "./definitions.js";
import { invokeAgent, type AgentBody } from "./runner.js";

// One focused Playwright spec for the requested change, committed to the task
// branch. Verification is implicit: the next Test Run executes the new spec.
export const e2eTestWriterBody: AgentBody = async (ctx) => {
  const { deps, sandbox, log, task, project } = ctx;
  const branch = task.branchName;
  if (!branch) throw new AgentOutputError("Task has no branch name");

  const manifest = await loadManifest(deps.github, project.defaultBranch);
  if (!manifest.e2e) {
    log("No e2e suite configured in the manifest; skipping spec writer");
    return;
  }
  if ((project as { reuseSandbox?: boolean }).reuseSandbox) {
    await prepareWorkspaceReuse(sandbox, deps.github, { ref: branch, manifest, agents: ["E2E_TEST_WRITER"], log });
  } else {
    await prepareWorkspace(sandbox, deps.github, { ref: branch, manifest, agents: ["E2E_TEST_WRITER"], log });
  }

  const changedFiles = task.pullRequestNumber ? await deps.github.getChangedFiles(task.pullRequestNumber).catch(() => [] as string[]) : [];
  // Playwright only runs what lives under `<cwd>/<testDir>`; pointing the agent
  // at the bare cwd (e.g. "fe") aims it at the whole frontend app, where any
  // spec it writes is invisible to the suite.
  const specDir = e2eSpecDir(manifest.e2e) || ".";
  const result = await invokeAgent(ctx, {
    agentName: AGENT_DEFINITIONS.E2E_TEST_WRITER.name,
    prompt: e2eTestWriterPrompt(task.title, task.description, task.plan, changedFiles, specDir, manifest.e2e.command),
    timeoutMs: TIMEOUTS.DEVELOPER,
    label: "E2E_TEST_WRITER",
  });

  let specPath = detectSpecPath(result.text) ?? (await newestSpec(sandbox, specDir, log));
  // The writer may report the spec path relative to the spec dir or to the e2e
  // cwd; normalize to repo-relative so `git add -- <path>` (and the stored
  // e2eGeneratedSpecPath) resolve from the repo root. Candidates are tried
  // longest-prefix first so the deepest match wins.
  if (specPath) {
    const exists = async (p: string) =>
      (await sandbox.exec(`test -f ${shellQuote(p)} && echo SDLC_EXISTS`, { cwd: WORKSPACE })).stdout.includes("SDLC_EXISTS");
    if (!(await exists(specPath))) {
      const bases = [specDir, manifest.e2e.cwd.replace(/\/+$/, "")].filter((b) => b && b !== ".");
      for (const base of bases) {
        const nested = `${base}/${specPath}`;
        if (await exists(nested)) {
          specPath = nested;
          break;
        }
      }
    }
  }
  // Commit only the detected spec: the reused workspace can hold stray
  // untracked files, and `git add -A` would push them onto the branch unseen.
  const { noChanges } = await commitAndPush(sandbox, deps.github, branch, `Add E2E coverage for: ${task.title}`, log, specPath ? [specPath] : undefined);
  if (noChanges && !specPath) throw new AgentOutputError("E2E test writer produced no spec to commit");

  const resolved = specPath ?? "e2e spec (path not reported)";
  await db.update(tasks).set({ e2eGeneratedSpecPath: specPath ?? tasks.e2eGeneratedSpecPath, updatedAt: new Date() }).where(eq(tasks.id, task.id));
  await bus.emit(task.id, "E2E_COVERAGE_DECIDED", { covered: false, generatedSpecPath: specPath ?? null, rationale: `Writer added ${resolved}` });
  log(`E2E spec ready: ${resolved}`);
};

function e2eTestWriterPrompt(title: string, description: string, plan: string | null, changedFiles: string[], specDir: string, command: string): string {
  return `# Task
Title: ${title}

${description || "(no description)"}

# Plan
${plan ?? "(no plan recorded)"}

# Changed files
${changedFiles.length ? changedFiles.map((f) => `- ${f}`).join("\n") : "- (unknown)"}

# E2E setup
- Spec directory (repo-relative, this is Playwright's testDir): ${specDir}
- Suite command: ${command}

# Rules
- Write exactly one focused Playwright spec under ${specDir} covering the user-visible change above. A spec written anywhere else is invisible to the suite.
- Follow the repo's existing spec conventions (imports, fixtures, selectors).
- Keep titles unique and deterministic. No sleeps, no external network.
- Do NOT commit or push. End with a line: SPEC_PATH: <relative path of the spec you wrote>.`;
}

const SPEC_PATH_SUFFIX = /\.(?:spec|e2e)\.[a-z]+$/i;

// The writer is instructed to end with "SPEC_PATH: <path>".
export function detectSpecPath(text: string): string | null {
  const match = text.match(/SPEC_PATH:\s*([^\s`'"]+\.spec\.[a-z]+|[^\s`'"]+\.e2e\.[a-z]+)/i);
  return match ? match[1]!.trim() : null;
}

// NUL-delimited `git status --porcelain=v1 -z`, parsed in JS instead of awk:
// unquoted paths, rename-safe, and repo-relative (run from the repo root,
// scoped to the resolved spec dir so a stray unit spec elsewhere in the app
// cannot be mistaken for the writer's output). Rename entries emit the old
// path as a bare NUL segment without an XY prefix, which the filter drops.
async function newestSpec(sandbox: { exec: (cmd: string, opts?: { cwd?: string }) => Promise<{ stdout: string }> }, specDir: string, log: (l: string) => void): Promise<string | null> {
  try {
    const found = await sandbox.exec(`git status --porcelain=v1 -z -- ${shellQuote(specDir)}`, { cwd: WORKSPACE });
    const spec = found.stdout
      .split("\0")
      .filter((entry) => /^[A-Z?! ]{2} /.test(entry))
      .map((entry) => entry.slice(3))
      .find((p) => SPEC_PATH_SUFFIX.test(p));
    return spec ?? null;
  } catch (e) {
    log(`Could not detect new spec path: ${tail(String(e), 500)}`);
    return null;
  }
}
