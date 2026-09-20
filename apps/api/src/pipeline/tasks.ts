import { and, desc, eq, gte, ne } from "drizzle-orm";
import type { Agent, RunStatus, Stage, TaskStatus } from "@sdlc-ai/shared";
import { db } from "../db/index.js";
import {
  agentRuns,
  approvals,
  projects,
  questions,
  reviews,
  tasks,
  testRuns,
  type AgentRunRow,
  type ApprovalRow,
  type ProjectRow,
  type QuestionRow,
  type ReviewRow,
  type TaskRow,
  type TestRunRow,
} from "../db/schema.js";
import { HttpError } from "../errors.js";
import { bus } from "../events/bus.js";

export async function getProject(): Promise<ProjectRow> {
  const [project] = await db.select().from(projects).limit(1);
  if (!project) throw new Error("Project row missing; API did not seed the project");
  return project;
}

export async function getTask(id: string): Promise<TaskRow | null> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return task ?? null;
}

export async function requireTask(id: string): Promise<TaskRow> {
  const task = await getTask(id);
  if (!task) throw new HttpError(404, "Task not found");
  return task;
}

export async function updateTask(id: string, values: Partial<typeof tasks.$inferInsert>): Promise<TaskRow> {
  const [row] = await db
    .update(tasks)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  if (!row) throw new HttpError(404, "Task not found");
  return row;
}

export async function setStatus(task: TaskRow, status: TaskStatus, payload: Record<string, unknown> = {}): Promise<TaskRow> {
  if (task.status === status) return task;
  const row = await updateTask(task.id, { status });
  await bus.emit(task.id, "TASK_STATUS_CHANGED", { status, from: task.status, to: status, stage: task.stage, ...payload });
  return row;
}

export async function transition(task: TaskRow, stage: Stage, status: TaskStatus): Promise<TaskRow> {
  const row = await updateTask(task.id, { stage, status, stageEnteredAt: new Date(), error: null });
  await bus.emit(task.id, "TASK_STAGE_CHANGED", { from: task.stage, to: stage, status });
  return row;
}

export async function failTask(taskId: string, error: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task || task.status === "FAILED" || task.status === "COMPLETED") return;
  await updateTask(taskId, { status: "FAILED", error });
  await bus.emit(taskId, "TASK_STATUS_CHANGED", { status: "FAILED", from: task.status, to: "FAILED", stage: task.stage });
  await bus.emit(taskId, "TASK_FAILED", { stage: task.stage, error });
}

export async function getAgentRun(id: string): Promise<AgentRunRow | null> {
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
  return run ?? null;
}

export const isActiveRun = (status: RunStatus) => status === "QUEUED" || status === "RUNNING";
export const isFailedRun = (status: RunStatus) => status === "FAILED" || status === "TIMED_OUT";

export async function latestAgentRun(taskId: string, agent: Agent, since: Date): Promise<AgentRunRow | null> {
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.taskId, taskId), eq(agentRuns.agent, agent), gte(agentRuns.createdAt, since), ne(agentRuns.status, "CANCELLED")))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1);
  return run ?? null;
}

export async function latestTestRun(taskId: string, since?: Date): Promise<TestRunRow | null> {
  const conditions = [eq(testRuns.taskId, taskId), ne(testRuns.status, "CANCELLED")];
  if (since) conditions.push(gte(testRuns.createdAt, since));
  const [run] = await db
    .select()
    .from(testRuns)
    .where(and(...conditions))
    .orderBy(desc(testRuns.createdAt))
    .limit(1);
  return run ?? null;
}

/** Next 1-based attempt number, counting CANCELLED runs so restarts never reuse "attempt 1". */
export async function nextTestAttempt(taskId: string): Promise<number> {
  const [row] = await db
    .select({ attempt: testRuns.attempt })
    .from(testRuns)
    .where(eq(testRuns.taskId, taskId))
    .orderBy(desc(testRuns.attempt))
    .limit(1);
  return (row?.attempt ?? 0) + 1;
}

/** Next 1-based attempt number for an agent, counting CANCELLED runs. */
export async function nextAgentAttempt(taskId: string, agent: Agent): Promise<number> {
  const [row] = await db
    .select({ attempt: agentRuns.attempt })
    .from(agentRuns)
    .where(and(eq(agentRuns.taskId, taskId), eq(agentRuns.agent, agent)))
    .orderBy(desc(agentRuns.attempt))
    .limit(1);
  return (row?.attempt ?? 0) + 1;
}

export async function pendingQuestion(taskId: string, since: Date): Promise<QuestionRow | null> {
  const [q] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.taskId, taskId), eq(questions.status, "PENDING"), gte(questions.createdAt, since)))
    .orderBy(desc(questions.createdAt))
    .limit(1);
  return q ?? null;
}

export async function answeredQuestion(taskId: string, since: Date): Promise<QuestionRow | null> {
  const [q] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.taskId, taskId), eq(questions.status, "ANSWERED"), gte(questions.createdAt, since)))
    .orderBy(desc(questions.createdAt))
    .limit(1);
  return q ?? null;
}

export async function reviewsSince(taskId: string, since: Date): Promise<ReviewRow[]> {
  return db
    .select()
    .from(reviews)
    .where(and(eq(reviews.taskId, taskId), gte(reviews.createdAt, since)))
    .orderBy(desc(reviews.createdAt));
}

export async function latestApproval(taskId: string, since: Date): Promise<ApprovalRow | null> {
  const [a] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.taskId, taskId), gte(approvals.createdAt, since)))
    .orderBy(desc(approvals.createdAt))
    .limit(1);
  return a ?? null;
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "task"
  );
}

export function tail(text: string, max: number): string {
  return text.length > max ? `…(truncated)…\n${text.slice(-max)}` : text;
}
