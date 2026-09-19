import path from "node:path";
import { eq } from "drizzle-orm";
import type { RunStatus } from "@sdlc-ai/shared";
import { db } from "../db/index.js";
import { testRuns, type TestRunRow } from "../db/schema.js";
import { AgentOutputError, SandboxError, TimeoutError, errorMessage } from "../errors.js";
import { bus } from "../events/bus.js";
import { loadManifest } from "../integrations/manifest.js";
import type { Sandbox } from "../ports.js";
import { WORKSPACE } from "../sandbox/docker.js";
import { prepareWorkspace } from "../sandbox/workspace.js";
import { TIMEOUTS, type Deps } from "./deps.js";
import { failTask, getProject, getTask, tail } from "./tasks.js";

export async function startTestRun(deps: Deps, taskId: string, attempt = 1): Promise<TestRunRow> {
  const [run] = await db.insert(testRuns).values({ taskId, attempt, status: "QUEUED", createdAt: new Date() }).returning();
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
    await db.update(testRuns).set({ command: manifest.e2e.command }).where(eq(testRuns.id, run.id));

    sandbox = await deps.sandboxes.create({ name: `sdlc-e2e-${run.id.slice(0, 8)}-a${run.attempt}` });
    await prepareWorkspace(sandbox, deps.github, { ref: task.branchName, manifest, agents: [], log });

    const cwd = manifest.e2e.cwd === "." ? WORKSPACE : `${WORKSPACE}/${manifest.e2e.cwd}`;
    log(`$ ${manifest.e2e.command}  (cwd ${cwd})`);
    const started = Date.now();
    const result = await sandbox.exec(manifest.e2e.command, {
      cwd,
      env: manifest.e2e.env,
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
    for (const artifactPath of manifest.e2e.artifacts) {
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
  } catch (e) {
    error = errorMessage(e);
    if (e instanceof TimeoutError) {
      status = "TIMED_OUT";
    } else {
      status = "FAILED";
      willRetry = e instanceof SandboxError && run.attempt < 2;
    }
    log(`ERROR: ${error}`);
  } finally {
    if (sandbox) await sandbox.destroy().catch(() => undefined);
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
