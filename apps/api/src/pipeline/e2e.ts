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
      log(`Test Run finished with exit code ${exitCode}: ${summary.passed ?? 0} passed, ${summary.failed ?? 0} failed`);
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

export function e2eFeedback(run: TestRunRow): string {
  return `The E2E Test Run failed (exit code ${run.exitCode ?? "n/a"}; ${run.passed ?? 0} passed, ${run.failed ?? 0} failed). Fix the failing tests or the code they cover. Output:\n\n${run.output ?? "(no output captured)"}`;
}

// --- Forced video -----------------------------------------------------------

const OVERLAY_PATH = "/tmp/sdlc-pw.config.ts";

export function isPlaywrightCommand(command: string): boolean {
  return /playwright|test:e2e/i.test(command);
}

// Appends the conventional Playwright output dir for this run only when the
// manifest does not already cover it. Never persisted to the manifest.
export function withVideoDir(e2e: E2eConfig, videoDir: string | null): string[] {
  if (!videoDir) return e2e.artifacts;
  const covered = e2e.artifacts.some((a) => a === videoDir || a.startsWith(`${videoDir}/`) || videoDir.startsWith(`${a}/`) || a === videoDir.split("/").pop());
  return covered ? e2e.artifacts : [...e2e.artifacts, videoDir];
}

// Probes for a Playwright config without a video setting and, when found,
// writes a temporary overlay config extending it with video/screenshot on.
// Non-Playwright commands or any probe failure → env-only fallback (logged).
export async function forceVideoOn(
  sandbox: Sandbox,
  e2e: E2eConfig,
  cwd: string,
  log: (line: string) => void,
): Promise<{ command: string; videoDir: string | null }> {
  const fallback = { command: e2e.command, videoDir: videoDirFor(e2e) };
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
    const overlay =
      `// Temporary SDLC overlay: extends the project config with video on. Never committed.\n` +
      `import base from '${cwd}/${configFile}';\n` +
      `const b = (base as any)?.default ?? base as any;\n` +
      `export default { ...b, use: { ...(b?.use ?? {}), video: 'retain-on-failure', screenshot: 'only-on-failure' } };\n`;
    await sandbox.writeFile(OVERLAY_PATH, overlay);
    log(`Forcing Playwright video via overlay config ${OVERLAY_PATH} (extends ${configFile})`);
    return { command: `${e2e.command} --config ${OVERLAY_PATH}`, videoDir: fallback.videoDir };
  } catch (e) {
    log(`Video overlay probe failed; falling back to env injection: ${errorMessage(e)}`);
    return fallback;
  }
}

function videoDirFor(e2e: E2eConfig): string | null {
  if (!isPlaywrightCommand(e2e.command)) return null;
  return e2e.cwd === "." ? "test-results" : `${e2e.cwd}/test-results`;
}
