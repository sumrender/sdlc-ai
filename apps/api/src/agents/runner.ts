import { eq } from "drizzle-orm";
import type { Agent } from "@sdlc-ai/shared";
import { db } from "../db/index.js";
import { agentRuns, type AgentRunRow, type ProjectRow, type TaskRow } from "../db/schema.js";
import { env } from "../env.js";
import { AgentOutputError, SandboxError, TimeoutError, errorMessage } from "../errors.js";
import { bus } from "../events/bus.js";
import type { Sandbox } from "../ports.js";
import type { Deps } from "../pipeline/deps.js";
import { failTask, getProject, getTask, nextAgentAttempt } from "../pipeline/tasks.js";
import { runOpenCode, type OpenCodeResult } from "../sandbox/opencode.js";
import { TaskSandboxPool } from "../sandbox/task-pool.js";

export interface RunContext {
  deps: Deps;
  sandbox: Sandbox;
  log: (line: string) => void;
  run: AgentRunRow;
  task: TaskRow;
  project: ProjectRow;
}

export type AgentBody = (ctx: RunContext) => Promise<void>;

export async function startAgentRun(deps: Deps, taskId: string, agent: Agent, body: AgentBody, attempt?: number): Promise<AgentRunRow> {
  const resolved = attempt ?? (await nextAgentAttempt(taskId, agent));
  const model = agent === "DEVELOPER" ? env.MODEL_DEVELOPER : env.MODEL_FAST;
  const [run] = await db
    .insert(agentRuns)
    .values({ taskId, agent, attempt: resolved, model, status: "QUEUED", createdAt: new Date() })
    .returning();
  void execute(deps, run!, body);
  return run!;
}

async function execute(deps: Deps, run: AgentRunRow, body: AgentBody): Promise<void> {
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(`${new Date().toISOString()} ${line}`);
    bus.output(run.taskId, { agentRunId: run.id }, line);
  };

  await db.update(agentRuns).set({ status: "RUNNING", startedAt: new Date() }).where(eq(agentRuns.id, run.id));
  await bus.emit(run.taskId, "AGENT_RUN_STARTED", { agentRunId: run.id, agent: run.agent, attempt: run.attempt, model: run.model });

  let outcome: "COMPLETED" | "FAILED" | "TIMED_OUT" = "COMPLETED";
  let error: string | null = null;
  let willRetry = false;
  let sandbox: Sandbox | null = null;

  try {
    const task = await getTask(run.taskId);
    if (!task) throw new Error("Task no longer exists");
    const project = await getProject();
    log(`Starting ${run.agent} (attempt ${run.attempt}, model ${run.model})`);
    const pool = deps.sandboxes instanceof TaskSandboxPool ? deps.sandboxes : null;
    const reuse = Boolean(pool && (project as { reuseSandbox?: boolean }).reuseSandbox);
    if (reuse && pool) {
      const shared = await pool.acquire(task.id);
      sandbox = shared;
      log(`Reusing container ${shared.name} (setup once, fresh session)`);
      // Serialize the whole agent body per task: parallel reviewers share this
      // container's /workspace, and concurrent git fetch/checkout/reset +
      // opencode runs would interleave (mixed diffs, PR comment races).
      await pool.withLock(task.id, () => body({ deps, sandbox: shared, log, run, task, project }));
    } else {
      const own = await deps.sandboxes.create({
        name: `sdlc-${run.agent.toLowerCase().replace(/_/g, "-")}-${run.id.slice(0, 8)}-a${run.attempt}`,
        // The Planner's answer run resumes the question run's session from a new Sandbox.
        sessionVolume: run.agent === "PLANNER" ? `sdlc-ai-opencode-${run.taskId}` : undefined,
      });
      sandbox = own;
      await body({ deps, sandbox: own, log, run, task, project });
    }
    log(`${run.agent} completed`);
  } catch (e) {
    error = errorMessage(e);
    if (e instanceof TimeoutError) {
      outcome = "TIMED_OUT";
      // Timeouts are often transient stalls (cold container, slow provider);
      // give the run one more attempt instead of failing the task outright.
      willRetry = run.attempt < 2;
    } else {
      outcome = "FAILED";
      willRetry = e instanceof SandboxError && run.attempt < 2;
    }
    log(`ERROR: ${error}`);
  } finally {
    const pool = deps.sandboxes instanceof TaskSandboxPool ? deps.sandboxes : null;
    const shared = Boolean(sandbox && pool && pool.has(run.taskId));
    if (sandbox && !shared) await sandbox.destroy().catch(() => undefined);
    await deps.artifacts
      .saveLog({
        taskId: run.taskId,
        agentRunId: run.id,
        name: `${run.agent.toLowerCase()}-attempt-${run.attempt}.log`,
        content: lines.join("\n"),
      })
      .catch((e) => console.error("[runner] failed to save log artifact", e));
  }

  await db.update(agentRuns).set({ status: outcome, completedAt: new Date(), error }).where(eq(agentRuns.id, run.id));
  await bus.emit(run.taskId, outcome === "COMPLETED" ? "AGENT_RUN_COMPLETED" : "AGENT_RUN_FAILED", {
    agentRunId: run.id,
    agent: run.agent,
    attempt: run.attempt,
    status: outcome,
    error,
    willRetry,
  });

  if (willRetry) {
    await startAgentRun(deps, run.taskId, run.agent, body, run.attempt + 1);
    return;
  }
  if (outcome !== "COMPLETED") {
    await failTask(run.taskId, `${run.agent} ${outcome.toLowerCase().replace("_", " ")}: ${error}`);
  }
  await deps.advance(run.taskId);
}

export interface InvokeOptions {
  agentName: string;
  prompt: string;
  sessionId?: string | null;
  timeoutMs: number;
  label: string;
  dataDir?: string | null;
}

export async function invokeAgent(ctx: RunContext, options: InvokeOptions): Promise<OpenCodeResult> {
  const call = (sessionId: string | null | undefined) =>
    runOpenCode(ctx.sandbox, {
      agent: options.agentName,
      model: ctx.run.model,
      prompt: options.prompt,
      apiKey: env.OPENCODE_API_KEY ?? "",
      sessionId,
      timeoutMs: options.timeoutMs,
      onLine: ctx.log,
      dataDir: options.dataDir ?? null,
    });

  let result = await call(options.sessionId);
  if (result.timedOut) throw new TimeoutError(`${options.label} timed out after ${Math.round(options.timeoutMs / 60_000)} minutes`);
  if (result.exitCode !== 0 && options.sessionId) {
    ctx.log("opencode could not resume the previous session; retrying without --session");
    result = await call(null);
    if (result.timedOut) throw new TimeoutError(`${options.label} timed out after ${Math.round(options.timeoutMs / 60_000)} minutes`);
  }
  if (result.exitCode !== 0) throw new AgentOutputError(`${options.label}: opencode exited with code ${result.exitCode}`);
  if (result.sessionId) {
    await db.update(agentRuns).set({ opencodeSessionId: result.sessionId }).where(eq(agentRuns.id, ctx.run.id));
  }
  return result;
}
