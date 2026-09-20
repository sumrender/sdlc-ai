import path from "node:path";
import { eq } from "drizzle-orm";
import type { RunStatus } from "@sdlc-ai/shared";
import { db } from "../db/index.js";
import { testRuns, type TestRunRow } from "../db/schema.js";
import { AgentOutputError, SandboxError, TimeoutError, errorMessage } from "../errors.js";
import { bus } from "../events/bus.js";
import { loadManifest } from "../integrations/manifest.js";
import type { E2eConfig } from "@sdlc-ai/shared";
import type { Sandbox } from "../ports.js";
import { WORKSPACE } from "../sandbox/docker.js";
import { shellQuote, shellQuoteIfNeeded } from "../sandbox/process.js";
import { prepareWorkspace, prepareWorkspaceReuse } from "../sandbox/workspace.js";
import { TaskSandboxPool } from "../sandbox/task-pool.js";
import { TIMEOUTS, type Deps } from "./deps.js";
import { postE2EReport } from "./e2e-report.js";
import { failTask, getProject, getTask, nextTestAttempt, tail } from "./tasks.js";

export async function startTestRun(deps: Deps, taskId: string, attempt?: number): Promise<TestRunRow> {
  const resolved = attempt ?? (await nextTestAttempt(taskId));
  const [run] = await db.insert(testRuns).values({ taskId, attempt: resolved, status: "QUEUED", createdAt: new Date() }).returning();
  void execute(deps, run!);
  return run!;
}

async function execute(deps: Deps, run: TestRunRow): Promise<void> {
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(`${new Date().toISOString()} ${line}`);
    bus.output(run.taskId, { testRunId: run.id }, line);
  };

  await db.update(testRuns).set({ status: "RUNNING", startedAt: new Date() }).where(eq(testRuns.id, run.id));
  await bus.emit(run.taskId, "TEST_RUN_STARTED", { testRunId: run.id, attempt: run.attempt });

  let status: RunStatus = "COMPLETED";
  let error: string | null = null;
  let willRetry = false;
  let exitCode: number | null = null;
  let durationMs: number | null = null;
  let output: string | null = null;
  let summary = { passed: null as number | null, failed: null as number | null, skipped: null as number | null };
  let sandbox: Sandbox | null = null;
  let cleanupOverlay: (() => Promise<void>) | null = null;

  try {
    const task = await getTask(run.taskId);
    if (!task) throw new Error("Task no longer exists");
    if (!task.branchName) throw new AgentOutputError("Task has no branch name");
    const project = await getProject();
    const manifest = await loadManifest(deps.github, project.defaultBranch);
    if (!manifest.e2e) {
      // Project has no e2e suite (optional): record a passing no-op run.
      exitCode = 0;
      durationMs = 0;
      output = "No e2e suite configured in the manifest; skipped.";
      summary = { passed: 0, failed: 0, skipped: 0 };
      log(output);
      await db.update(testRuns).set({ command: "(skipped: no e2e configured)" }).where(eq(testRuns.id, run.id));
    } else {
      await db.update(testRuns).set({ command: manifest.e2e.command }).where(eq(testRuns.id, run.id));

      sandbox = null;
      const pool = deps.sandboxes instanceof TaskSandboxPool ? deps.sandboxes : null;
      const reuse = Boolean(pool && (project as { reuseSandbox?: boolean }).reuseSandbox);
      if (reuse && pool) {
        sandbox = await pool.acquire(task.id);
        log(`Reusing container ${sandbox.name} for Test Run`);
        await prepareWorkspaceReuse(sandbox, deps.github, { ref: task.branchName, manifest, agents: [], log });
      } else {
        sandbox = await deps.sandboxes.create({ name: `sdlc-e2e-${run.id.slice(0, 8)}-a${run.attempt}` });
        await prepareWorkspace(sandbox, deps.github, { ref: task.branchName, manifest, agents: [], log });
      }

      const e2e = manifest.e2e;
      const cwd = e2e.cwd === "." ? WORKSPACE : `${WORKSPACE}/${e2e.cwd}`;
      const forced = await forceVideoOn(sandbox, e2e, cwd, log);
      cleanupOverlay = forced.cleanup;
      const command = forced.command;
      const env = { ...e2e.env, PLAYWRIGHT_VIDEO: "on" };
      log(`$ ${command}  (cwd ${cwd})`);
      const started = Date.now();
      const result = await sandbox.exec(command, {
        cwd,
        env,
        timeoutMs: TIMEOUTS.TEST_RUN,
        onLine: log,
      });
      durationMs = Date.now() - started;
      if (result.timedOut) throw new TimeoutError("Test Run timed out after 10 minutes");

      exitCode = result.exitCode;
      const combined = `${result.stdout}\n${result.stderr}`;
      summary = parsePlaywrightSummary(combined);
      output = tail(combined, 20_000);

      const dest = await deps.artifacts.testRunDir(task.id, run.id);
      const artifactPaths = withVideoDir(e2e, forced.videoDir);
      for (const artifactPath of artifactPaths) {
        const copied = await sandbox.copyOut(`${WORKSPACE}/${artifactPath}`, dest);
        if (!copied) {
          log(`No artifacts found at ${artifactPath}`);
          continue;
        }
        const count = await deps.artifacts.importDir({
          taskId: task.id,
          testRunId: run.id,
          dir: path.join(dest, path.basename(artifactPath)),
          prefix: artifactPath,
        });
        log(`Copied ${count} artifact file(s) from ${artifactPath}`);
      }
      log(`Test Run finished with exit code ${exitCode}: ${describeSummary(summary)}`);
    }
  } catch (e) {
    error = errorMessage(e);
    if (e instanceof TimeoutError) {
      status = "TIMED_OUT";
      // Transient stalls get one retry, same as SandboxError.
      willRetry = run.attempt < 2;
    } else {
      status = "FAILED";
      willRetry = e instanceof SandboxError && run.attempt < 2;
    }
    log(`ERROR: ${error}`);
  } finally {
    // The overlay lives inside the Workspace (Playwright resolves a config's
    // relative paths against its own directory), so it must not outlive the run.
    if (cleanupOverlay) await cleanupOverlay().catch(() => undefined);
    if (sandbox) {
      const pool = deps.sandboxes instanceof TaskSandboxPool ? deps.sandboxes : null;
      const shared = Boolean(pool && pool.has(run.taskId));
      if (!shared) await sandbox.destroy().catch(() => undefined);
    }
    await deps.artifacts
      .saveLog({ taskId: run.taskId, testRunId: run.id, name: `e2e-attempt-${run.attempt}.log`, content: lines.join("\n") })
      .catch((e) => console.error("[e2e] failed to save log artifact", e));
  }

  await db
    .update(testRuns)
    .set({ status, exitCode, durationMs, output, error, completedAt: new Date(), ...summary })
    .where(eq(testRuns.id, run.id));
  await bus.emit(run.taskId, "TEST_RUN_COMPLETED", {
    testRunId: run.id,
    attempt: run.attempt,
    status,
    exitCode,
    durationMs,
    ...summary,
  });

  if (status === "COMPLETED") {
    // Report back to the PR after every finished suite (pass or fail).
    // Failures here must never fail the task — the gate below owns that.
    try {
      const task = await getTask(run.taskId);
      if (task?.pullRequestNumber) {
        await postE2EReport(deps, { task, run: { ...run, status, exitCode, ...summary }, generatedSpecPath: task.e2eGeneratedSpecPath }, log);
      }
    } catch (e) {
      log(`E2E PR report skipped: ${errorMessage(e)}`);
    }
  }

  if (willRetry) {
    await startTestRun(deps, run.taskId, run.attempt + 1);
    return;
  }
  if (status !== "COMPLETED") await failTask(run.taskId, `Test Run ${status.toLowerCase().replace("_", " ")}: ${error}`);
  await deps.advance(run.taskId);
}

export function parsePlaywrightSummary(text: string) {
  const count = (re: RegExp) => {
    const match = text.match(re);
    return match ? Number(match[1]) : null;
  };
  return {
    passed: count(/(\d+)\s+passed/),
    failed: count(/(\d+)\s+failed/),
    skipped: count(/(\d+)\s+skipped/),
  };
}

// Playwright prints no summary when the suite never ran (bad config, web server
// that would not start). Reporting that as "0 passed, 0 failed" reads like a
// green-but-empty suite, so say plainly that nothing ran.
export function describeSummary(summary: { passed: number | null; failed: number | null }): string {
  if (summary.passed === null && summary.failed === null) return "no results reported (the suite did not run)";
  return `${summary.passed ?? 0} passed, ${summary.failed ?? 0} failed`;
}

export function e2eFeedback(run: TestRunRow): string {
  const detail = describeSummary({ passed: run.passed, failed: run.failed });
  const lead =
    run.passed === null && run.failed === null
      ? `The E2E Test Run failed before any test ran (exit code ${run.exitCode ?? "n/a"}; ${detail}). Read the output below: it is usually a config, dependency or web-server problem rather than a failing assertion.`
      : `The E2E Test Run failed (exit code ${run.exitCode ?? "n/a"}; ${detail}). Fix the failing tests or the code they cover.`;
  return `${lead} Output:\n\n${run.output ?? "(no output captured)"}`;
}

// --- Forced video -----------------------------------------------------------

const OVERLAY_BASENAME = "sdlc-pw.config.ts";

export function isPlaywrightCommand(command: string): boolean {
  return /playwright|test:e2e/i.test(command);
}

// `npm run <script> --config X` makes npm claim `--config` as its own option and
// forward only the bare path, which Playwright then reads as a test-file filter
// ("No tests found"). Package-manager run wrappers need the `--` separator;
// direct invocations (`npx playwright test`, `yarn e2e`) must not get one,
// since they would pass it straight through to the underlying binary.
const NEEDS_ARG_SEPARATOR = /(^|[;&|]\s*)(npm|pnpm)\s/;

export function appendCliArg(command: string, arg: string): string {
  if (/(^|\s)--(\s|$)/.test(command)) return `${command} ${arg}`;
  return NEEDS_ARG_SEPARATOR.test(command) ? `${command} -- ${arg}` : `${command} ${arg}`;
}

// Appends the conventional Playwright output dir for this run only when the
// manifest does not already cover it. Never persisted to the manifest.
export function withVideoDir(e2e: E2eConfig, videoDir: string | null): string[] {
  if (!videoDir) return e2e.artifacts;
  const covered = e2e.artifacts.some((a) => a === videoDir || a.startsWith(`${videoDir}/`) || videoDir.startsWith(`${a}/`) || a === videoDir.split("/").pop());
  return covered ? e2e.artifacts : [...e2e.artifacts, videoDir];
}

export interface ForcedVideo {
  command: string;
  videoDir: string | null;
  // Removes the overlay from the Workspace; null when no overlay was written.
  cleanup: (() => Promise<void>) | null;
}

// Probes for a Playwright config without a video setting and, when found,
// writes a temporary overlay config extending it with video/screenshot on.
// Non-Playwright commands or any probe failure → env-only fallback (logged).
//
// The overlay MUST sit beside the config it extends: Playwright resolves
// `testDir`, `outputDir`, reporter folders and `webServer.cwd` against the
// directory of the config file it loaded, not against the process cwd. An
// overlay parked in /tmp silently relocated the whole suite there — the web
// server started in /tmp (ENOENT package.json) and no test was ever found.
export async function forceVideoOn(sandbox: Sandbox, e2e: E2eConfig, cwd: string, log: (line: string) => void): Promise<ForcedVideo> {
  const fallback: ForcedVideo = { command: e2e.command, videoDir: videoDirFor(e2e), cleanup: null };
  if (!isPlaywrightCommand(e2e.command)) {
    log("Non-Playwright e2e command; video forced via env only");
    return fallback;
  }
  if (e2e.command.includes("--config")) return fallback;
  try {
    const ls = await sandbox.exec(`ls playwright.config.* 2>/dev/null || ls config/playwright.* 2>/dev/null || true`, { cwd });
    const configFile = ls.stdout.split("\n").map((s) => s.trim()).find(Boolean);
    if (!configFile) {
      log("No playwright config found; video forced via env only");
      return fallback;
    }
    const content = await sandbox.exec(`cat ${configFile}`, { cwd });
    if (/video\s*:/.test(content.stdout)) return fallback;

    const configDir = posixDirname(`${cwd}/${configFile}`);
    const overlayPath = `${configDir}/${OVERLAY_BASENAME}`;
    const overlay =
      `// Temporary SDLC overlay: extends the project config with video on. Never committed.\n` +
      `import base from './${posixBasename(configFile)}';\n` +
      `const b = (base as any)?.default ?? base as any;\n` +
      `export default { ...b, use: { ...(b?.use ?? {}), video: 'retain-on-failure', screenshot: 'only-on-failure' } };\n`;
    await sandbox.writeFile(overlayPath, overlay);
    await excludeFromGit(sandbox, overlayPath);
    log(`Forcing Playwright video via overlay config ${overlayPath} (extends ${configFile})`);
    return {
      command: appendCliArg(e2e.command, `--config ${shellQuoteIfNeeded(overlayPath)}`),
      videoDir: fallback.videoDir,
      cleanup: async () => {
        await sandbox.exec(`rm -f ${shellQuote(overlayPath)}`, {});
      },
    };
  } catch (e) {
    log(`Video overlay probe failed; falling back to env injection: ${errorMessage(e)}`);
    return fallback;
  }
}

// The Workspace is reused across Agent Runs and the Developer stages with
// `git add -A`, so an untracked overlay would end up in the Task's PR. Git's
// per-clone exclude file keeps it invisible without touching the repository.
async function excludeFromGit(sandbox: Sandbox, overlayPath: string): Promise<void> {
  if (!overlayPath.startsWith(`${WORKSPACE}/`)) return;
  const relative = overlayPath.slice(WORKSPACE.length + 1);
  const exclude = ".git/info/exclude";
  await sandbox.exec(
    `mkdir -p .git/info && grep -qxF ${shellQuote(relative)} ${exclude} 2>/dev/null || echo ${shellQuote(relative)} >> ${exclude}`,
    { cwd: WORKSPACE },
  );
}

function posixDirname(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx <= 0 ? "/" : p.slice(0, idx);
}

function posixBasename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

function videoDirFor(e2e: E2eConfig): string | null {
  if (!isPlaywrightCommand(e2e.command)) return null;
  return e2e.cwd === "." ? "test-results" : `${e2e.cwd}/test-results`;
}
