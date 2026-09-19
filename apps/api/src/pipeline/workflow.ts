import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, notInArray } from "drizzle-orm";
import {
  ACTIVE_STAGES,
  DEMO_TASK,
  REVIEWERS,
  retryAvailability,
  sendBackAvailability,
  type CreateTaskInput,
  type DecideApprovalInput,
  type ResetDemoResult,
} from "@sdlc-ai/shared";
import { developerBody } from "../agents/developer.js";
import { e2eTestWriterBody } from "../agents/e2e-test-writer.js";
import { plannerBody } from "../agents/planner.js";
import { reviewerBody } from "../agents/reviewer.js";
import { startAgentRun } from "../agents/runner.js";
import { db } from "../db/index.js";
import {
  agentRuns,
  approvals,
  artifacts,
  deployments,
  events,
  questions,
  reviews,
  tasks,
  testRuns,
  type ReviewRow,
  type TaskRow,
} from "../db/schema.js";
import { env } from "../env.js";
import { HttpError, errorMessage } from "../errors.js";
import { bus } from "../events/bus.js";
import { TIMEOUTS, type Deps } from "./deps.js";
import { computeTouchedTargets, isTerminalDeployment, pollDeployments } from "./deployments.js";
import { e2eFeedback, startTestRun } from "./e2e.js";
import { ensureCoverage } from "./e2e-coverage.js";
import {
  failTask,
  getProject,
  isActiveRun,
  isFailedRun,
  latestAgentRun,
  latestApproval,
  latestTestRun,
  pendingQuestion,
  requireTask,
  reviewsSince,
  setStatus,
  slugify,
  transition,
  updateTask,
} from "./tasks.js";

const MAX_STEPS_PER_ADVANCE = 10;
const BRANCH_PREFIX = "sdlc/";

export class WorkflowService {
  readonly deps: Deps;
  private readonly chains = new Map<string, Promise<void>>();

  constructor(deps: Omit<Deps, "advance">) {
    this.deps = { ...deps, advance: (taskId) => this.advance(taskId) };
  }

  // The only place Transitions happen. Serialized per Task; idempotent; safe to call after a restart.
  advance(taskId: string): Promise<void> {
    const previous = this.chains.get(taskId) ?? Promise.resolve();
    const next = previous
      .then(() => this.step(taskId))
      .catch(async (e) => {
        console.error(`[workflow] advance(${taskId}) failed:`, e);
        await failTask(taskId, errorMessage(e)).catch(() => undefined);
      });
    this.chains.set(taskId, next);
    return next.finally(() => {
      if (this.chains.get(taskId) === next) this.chains.delete(taskId);
    });
  }

  private async step(taskId: string): Promise<void> {
    for (let i = 0; i < MAX_STEPS_PER_ADVANCE; i++) {
      const task = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1).then((r) => r[0]);
      if (!task || task.status === "FAILED" || task.status === "COMPLETED") return;
      const again = await this.evaluate(task);
      if (!again) return;
    }
  }

  private evaluate(task: TaskRow): Promise<boolean> {
    switch (task.stage) {
      case "TODO":
        return Promise.resolve(false);
      case "PLANNING":
        return this.planning(task);
      case "DEVELOPMENT":
        return this.development(task);
      case "E2E":
        return this.e2e(task);
      case "AGENT_REVIEW":
        return this.agentReview(task);
      case "HUMAN_REVIEW":
        return this.humanReview(task);
      case "STAGING":
        return this.staging(task);
    }
  }

  // Gate: a Plan exists and no Question is PENDING.
  private async planning(task: TaskRow): Promise<boolean> {
    if (task.plan) {
      await transition(task, "DEVELOPMENT", "READY");
      return true;
    }
    if (await pendingQuestion(task.id, task.stageEnteredAt)) {
      await setStatus(task, "WAITING", { agent: "PLANNER" });
      return false;
    }
    const run = await latestAgentRun(task.id, "PLANNER", task.stageEnteredAt);
    if (run && isActiveRun(run.status)) return false;
    if (run && isFailedRun(run.status)) {
      await failTask(task.id, run.error ?? `Planner ${run.status}`);
      return false;
    }
    await setStatus(task, "RUNNING", { agent: "PLANNER" });
    await startAgentRun(this.deps, task.id, "PLANNER", plannerBody);
    return false;
  }

  // Gate: the Developer run completed and a PR exists.
  private async development(task: TaskRow): Promise<boolean> {
    const run = await latestAgentRun(task.id, "DEVELOPER", task.stageEnteredAt);
    if (run?.status === "COMPLETED" && task.pullRequestNumber) {
      await transition(task, "E2E", "RUNNING");
      return true;
    }
    if (run && isActiveRun(run.status)) return false;
    if (run && isFailedRun(run.status)) {
      await failTask(task.id, run.error ?? `Developer ${run.status}`);
      return false;
    }
    if (run?.status === "COMPLETED") {
      await failTask(task.id, "Developer completed without opening a PR");
      return false;
    }
    await setStatus(task, "RUNNING", { agent: "DEVELOPER" });
    await startAgentRun(this.deps, task.id, "DEVELOPER", developerBody);
    return false;
  }

  // Gate: the latest Test Run passed. One automatic Reject loop to DEVELOPMENT per Task.
  // Coverage: once per E2E visit, ensure an e2e spec covers the diff (writer runs
  // inside the same loop budget — a writer failure fails the task outright).
  private async e2e(task: TaskRow): Promise<boolean> {
    const writerRun = await latestAgentRun(task.id, "E2E_TEST_WRITER", task.stageEnteredAt);
    if (writerRun && isActiveRun(writerRun.status)) return false;
    if (writerRun && isFailedRun(writerRun.status)) {
      await failTask(task.id, writerRun.error ?? `E2E_TEST_WRITER ${writerRun.status}`);
      return false;
    }
    const coverageChecked = task.e2eCoverageCheckedAt && task.e2eCoverageCheckedAt >= task.stageEnteredAt;
    if (!coverageChecked) {
      const coverage = await ensureCoverage(this.deps, task);
      if (!coverage.covered && !writerRun) {
        const fresh = await requireTask(task.id);
        await setStatus(fresh, "RUNNING", { agent: "E2E_TEST_WRITER" });
        await startAgentRun(this.deps, task.id, "E2E_TEST_WRITER", e2eTestWriterBody);
        return false;
      }
      task = await requireTask(task.id);
    }
    const run = await latestTestRun(task.id, task.stageEnteredAt);
    if (!run) {
      await setStatus(task, "RUNNING", { testRun: true });
      await startTestRun(this.deps, task.id);
      return false;
    }
    if (isActiveRun(run.status)) return false;
    if (run.status !== "COMPLETED") {
      await failTask(task.id, run.error ?? `Test Run ${run.status}`);
      return false;
    }
    if (run.exitCode === 0) {
      await transition(task, "AGENT_REVIEW", "RUNNING");
      return true;
    }
    if (!task.e2eRejectLoopUsed) {
      const feedback = task.e2eGeneratedSpecPath
        ? `${e2eFeedback(run)}\n\nThe E2E-generated spec (${task.e2eGeneratedSpecPath}) was part of this run; fix the spec or the code it covers.`
        : e2eFeedback(run);
      await updateTask(task.id, { e2eRejectLoopUsed: true, pendingFeedback: feedback });
      await transition(task, "DEVELOPMENT", "RUNNING");
      return true;
    }
    await failTask(task.id, `E2E failed again after the automatic Reject loop (${run.failed ?? "?"} failed)`);
    return false;
  }

  // Gate: four Reviews recorded. Verdicts are informational.
  private async agentReview(task: TaskRow): Promise<boolean> {
    const done = await reviewsSince(task.id, task.stageEnteredAt);
    if (REVIEWERS.every((r) => done.some((d) => d.reviewer === r))) {
      await transition(task, "HUMAN_REVIEW", "RUNNING");
      return true;
    }
    let started = false;
    for (const reviewer of REVIEWERS) {
      if (done.some((d) => d.reviewer === reviewer)) continue;
      const run = await latestAgentRun(task.id, reviewer, task.stageEnteredAt);
      if (!run) {
        await startAgentRun(this.deps, task.id, reviewer, reviewerBody(reviewer));
        started = true;
      } else if (isFailedRun(run.status)) {
        await failTask(task.id, run.error ?? `${reviewer} ${run.status}`);
        return false;
      }
    }
    if (started) await setStatus(task, "RUNNING", { agent: "REVIEWERS" });
    return false;
  }

  // Gate: an APPROVED Approval. Only a human can create one, via the REST API.
  private async humanReview(task: TaskRow): Promise<boolean> {
    const approval = await latestApproval(task.id, task.stageEnteredAt);
    if (!approval) {
      const [created] = await db.insert(approvals).values({ taskId: task.id, createdAt: new Date() }).returning();
      await bus.emit(task.id, "APPROVAL_REQUESTED", { approvalId: created!.id });
      await setStatus(task, "WAITING", { approvalId: created!.id });
      return false;
    }
    if (approval.status === "PENDING") {
      await setStatus(task, "WAITING", { approvalId: approval.id });
      return false;
    }
    if (approval.status === "REJECTED") {
      const findings = await reviewsSince(task.id, task.stageEnteredAt);
      await updateTask(task.id, { pendingFeedback: humanRejectFeedback(approval.feedback ?? "", findings) });
      await transition(task, "DEVELOPMENT", "RUNNING");
      return true;
    }

    if (!task.mergedCommitSha) {
      if (!task.pullRequestNumber || !task.branchName) throw new Error("Approved Task has no PR to merge");
      await setStatus(task, "RUNNING", { merging: true });
      const changedFiles = await this.deps.github.getChangedFiles(task.pullRequestNumber);
      const { sha } = await this.deps.github.squashMerge(task.pullRequestNumber, task.title);
      await this.deps.github.deleteBranch(task.branchName);
      await updateTask(task.id, { mergedCommitSha: sha });
      await bus.emit(task.id, "MERGED", { sha, pullRequestNumber: task.pullRequestNumber, changedFiles });

      const project = await getProject();
      const touched = computeTouchedTargets(changedFiles, project.deployTargets);
      if (touched.length > 0) {
        await db.insert(deployments).values(
          touched.map((t) => ({ taskId: task.id, target: t.target, provider: t.provider, commitSha: sha, url: t.url, createdAt: new Date() })),
        );
      }
    }
    await transition(task, "STAGING", "RUNNING");
    return true;
  }

  // Completion: every touched Deploy Target's Deployment is LIVE for the merged commit.
  private async staging(task: TaskRow): Promise<boolean> {
    let rows = await pollDeployments(this.deps, task);
    if (rows.length === 0 || rows.every((d) => d.status === "LIVE")) {
      await setStatus(task, "COMPLETED");
      return false;
    }
    const failed = rows.find((d) => d.status === "FAILED");
    if (failed) {
      await failTask(task.id, `Deployment of ${failed.target} via ${failed.provider} failed${failed.error ? `: ${failed.error}` : ""}`);
      return false;
    }
    if (Date.now() - task.stageEnteredAt.getTime() > TIMEOUTS.DEPLOYMENT) {
      for (const d of rows.filter((d) => !isTerminalDeployment(d))) {
        await db.update(deployments).set({ status: "TIMED_OUT" }).where(eq(deployments.id, d.id));
        await bus.emit(task.id, "DEPLOYMENT_UPDATED", { deploymentId: d.id, target: d.target, provider: d.provider, from: d.status, to: "TIMED_OUT" });
      }
      await failTask(task.id, "Deployment not live within 15 minutes");
      return false;
    }
    rows = await db.select().from(deployments).where(eq(deployments.taskId, task.id));
    if (rows.every((d) => d.status === "LIVE")) await setStatus(task, "COMPLETED");
    return false;
  }

  // ---- Operator actions -------------------------------------------------

  async createTask(input: CreateTaskInput): Promise<TaskRow> {
    const project = await getProject();
    const id = randomUUID();
    const branchName = `${BRANCH_PREFIX}${id.slice(0, 8)}-${slugify(input.title)}`;
    const issue = await this.deps.github.createIssue(
      input.title,
      `${input.description || "_No description._"}\n\n---\nOpened by the SDLC control plane: ${env.CONTROL_PLANE_URL}/tasks/${id}`,
    );
    const [task] = await db
      .insert(tasks)
      .values({
        id,
        projectId: project.id,
        title: input.title,
        description: input.description,
        branchName,
        issueNumber: issue.number,
        issueUrl: issue.url,
        stageEnteredAt: new Date(),
      })
      .returning();
    await bus.emit(id, "TASK_CREATED", {
      task: { ...task!, activeAgent: null, pendingQuestion: null, pendingApprovalId: null },
    });
    return task!;
  }

  async activeTask(): Promise<TaskRow | null> {
    const [row] = await db
      .select()
      .from(tasks)
      .where(inArray(tasks.stage, [...ACTIVE_STAGES]))
      .orderBy(asc(tasks.createdAt))
      .limit(1);
    return row ?? null;
  }

  async start(taskId: string): Promise<TaskRow> {
    const task = await requireTask(taskId);
    if (task.stage !== "TODO") throw new HttpError(409, `Task is already in ${task.stage}`);
    const active = await this.activeTask();
    if (active) throw new HttpError(409, `Another Task is active: "${active.title}" is in ${active.stage}. Only one Task may run between PLANNING and HUMAN_REVIEW.`);
    const row = await transition(task, "PLANNING", "RUNNING");
    await this.advance(taskId);
    return (await requireTask(taskId)) ?? row;
  }

  async retry(taskId: string): Promise<TaskRow> {
    const task = await requireTask(taskId);
    const retryable = retryAvailability(task);
    if (!retryable.allowed) throw new HttpError(409, retryable.reason);

    await bus.emit(taskId, "TASK_RETRIED", { stage: task.stage, previousError: task.error });
    if (task.stage === "STAGING") {
      // Re-poll, never re-merge.
      await db
        .update(deployments)
        .set({ status: "PENDING", error: null, lastPolledAt: null })
        .where(and(eq(deployments.taskId, taskId), inArray(deployments.status, ["FAILED", "TIMED_OUT"])));
      await updateTask(taskId, { status: "RUNNING", error: null, stageEnteredAt: new Date() });
    } else if (task.stage === "HUMAN_REVIEW") {
      await updateTask(taskId, { status: "RUNNING", error: null });
    } else {
      await updateTask(taskId, { status: "RUNNING", error: null, stageEnteredAt: new Date() });
    }
    await bus.emit(taskId, "TASK_STATUS_CHANGED", { status: "RUNNING", from: "FAILED", to: "RUNNING", stage: task.stage });
    await this.advance(taskId);
    return requireTask(taskId);
  }

  async sendBackToDevelopment(taskId: string): Promise<TaskRow> {
    const task = await requireTask(taskId);
    const sendable = sendBackAvailability(task);
    if (!sendable.allowed) throw new HttpError(409, sendable.reason);
    const run = await latestTestRun(taskId);
    await updateTask(taskId, { pendingFeedback: run ? e2eFeedback(run) : "E2E failed; see the Test Run logs.", error: null });
    await transition(task, "DEVELOPMENT", "RUNNING");
    await this.advance(taskId);
    return requireTask(taskId);
  }

  async answerQuestion(taskId: string, questionId: string, answer: string): Promise<TaskRow> {
    const [question] = await db
      .select()
      .from(questions)
      .where(and(eq(questions.id, questionId), eq(questions.taskId, taskId)))
      .limit(1);
    if (!question) throw new HttpError(404, "Question not found");
    if (question.status !== "PENDING") throw new HttpError(409, "Question already answered");
    await db.update(questions).set({ status: "ANSWERED", answer, answeredAt: new Date() }).where(eq(questions.id, questionId));
    await bus.emit(question.taskId, "QUESTION_ANSWERED", { questionId, answer });
    const task = await requireTask(question.taskId);
    if (task.status === "WAITING") await setStatus(task, "RUNNING", { agent: "PLANNER" });
    await this.advance(question.taskId);
    return requireTask(question.taskId);
  }

  async decideApproval(taskId: string, approvalId: string, input: DecideApprovalInput): Promise<TaskRow> {
    const [approval] = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.id, approvalId), eq(approvals.taskId, taskId)))
      .limit(1);
    if (!approval) throw new HttpError(404, "Approval not found");
    if (approval.status !== "PENDING") throw new HttpError(409, "Approval already decided");
    const feedback = input.decision === "REJECTED" ? input.feedback : null;
    await db.update(approvals).set({ status: input.decision, feedback, decidedAt: new Date() }).where(eq(approvals.id, approvalId));
    await bus.emit(approval.taskId, "APPROVAL_DECIDED", { approvalId, decision: input.decision, feedback });
    await this.advance(approval.taskId);
    return requireTask(approval.taskId);
  }

  async runDemo(): Promise<TaskRow> {
    const active = await this.activeTask();
    if (active) throw new HttpError(409, `Another Task is active: "${active.title}" is in ${active.stage}`);
    const task = await this.createTask({ ...DEMO_TASK });
    return this.start(task.id);
  }

  async resetDemo(): Promise<ResetDemoResult> {
    const all = await db.select().from(tasks);
    let issuesClosed = 0;
    let pullRequestsClosed = 0;
    for (const t of all) {
      if (t.mergedCommitSha) continue;
      if (t.pullRequestNumber) {
        await this.deps.github.closePullRequest(t.pullRequestNumber).then(() => pullRequestsClosed++, logSwallow("close PR"));
      }
      if (t.issueNumber) {
        await this.deps.github.closeIssue(t.issueNumber).then(() => issuesClosed++, logSwallow("close issue"));
      }
    }
    const branches = await this.deps.github.listBranches(BRANCH_PREFIX).catch(() => [] as string[]);
    let branchesDeleted = 0;
    for (const b of branches) await this.deps.github.deleteBranch(b).then(() => branchesDeleted++, logSwallow("delete branch"));

    await db.delete(tasks);
    await this.deps.artifacts.clear();
    this.chains.clear();
    return { tasksDeleted: all.length, issuesClosed, pullRequestsClosed, branchesDeleted };
  }

  // ---- Reads ------------------------------------------------------------

  // BoardTask[]: each Task plus the active Agent and the Question/Approval a WAITING card is blocked on.
  async listTasks() {
    const rows = await db.select().from(tasks).orderBy(desc(tasks.createdAt));
    if (rows.length === 0) return [];
    const [activeRuns, pendingQuestions, pendingApprovals] = await Promise.all([
      db
        .select({ taskId: agentRuns.taskId, agent: agentRuns.agent })
        .from(agentRuns)
        .where(inArray(agentRuns.status, ["QUEUED", "RUNNING"]))
        .orderBy(asc(agentRuns.createdAt)),
      db.select().from(questions).where(eq(questions.status, "PENDING")),
      db.select({ id: approvals.id, taskId: approvals.taskId }).from(approvals).where(eq(approvals.status, "PENDING")),
    ]);
    return rows.map((t) => ({
      ...t,
      activeAgent: activeRuns.find((r) => r.taskId === t.id)?.agent ?? null,
      pendingQuestion: pendingQuestions.find((q) => q.taskId === t.id) ?? null,
      pendingApprovalId: pendingApprovals.find((a) => a.taskId === t.id)?.id ?? null,
    }));
  }

  async boardTask(taskId: string) {
    const task = (await this.listTasks()).find((t) => t.id === taskId);
    if (!task) throw new HttpError(404, "Task not found");
    return task;
  }

  async taskDetail(taskId: string) {
    const task = await requireTask(taskId);
    const [runs, tests, qs, rvs, aps, deps, arts, evs] = await Promise.all([
      db.select().from(agentRuns).where(eq(agentRuns.taskId, taskId)).orderBy(asc(agentRuns.createdAt)),
      db.select().from(testRuns).where(eq(testRuns.taskId, taskId)).orderBy(asc(testRuns.createdAt)),
      db.select().from(questions).where(eq(questions.taskId, taskId)).orderBy(asc(questions.createdAt)),
      db.select().from(reviews).where(eq(reviews.taskId, taskId)).orderBy(asc(reviews.createdAt)),
      db.select().from(approvals).where(eq(approvals.taskId, taskId)).orderBy(asc(approvals.createdAt)),
      db.select().from(deployments).where(eq(deployments.taskId, taskId)).orderBy(asc(deployments.createdAt)),
      db
        .select({
          id: artifacts.id,
          taskId: artifacts.taskId,
          agentRunId: artifacts.agentRunId,
          testRunId: artifacts.testRunId,
          type: artifacts.type,
          name: artifacts.name,
          sizeBytes: artifacts.sizeBytes,
          createdAt: artifacts.createdAt,
        })
        .from(artifacts)
        .where(eq(artifacts.taskId, taskId))
        .orderBy(asc(artifacts.createdAt)),
      db.select().from(events).where(eq(events.taskId, taskId)).orderBy(asc(events.createdAt)),
    ]);
    return {
      ...task,
      agentRuns: runs,
      testRuns: tests.map(({ output: _output, ...rest }) => rest),
      questions: qs,
      reviews: rvs,
      approvals: aps,
      deployments: deps,
      artifacts: arts,
      events: evs,
    };
  }

  // ---- Lifecycle --------------------------------------------------------

  // Runs interrupted by a restart are CANCELLED (ignored by the gates) so advance() simply starts fresh ones.
  async recover(): Promise<void> {
    const interrupted = { status: "CANCELLED" as const, completedAt: new Date(), error: "API process restarted" };
    await db.update(agentRuns).set(interrupted).where(inArray(agentRuns.status, ["QUEUED", "RUNNING"]));
    await db.update(testRuns).set(interrupted).where(inArray(testRuns.status, ["QUEUED", "RUNNING"]));
    const open = await db
      .select()
      .from(tasks)
      .where(and(notInArray(tasks.status, ["FAILED", "COMPLETED"]), ne(tasks.stage, "TODO")));
    for (const t of open) {
      console.log(`[workflow] recovering task ${t.id} in ${t.stage}/${t.status}`);
      await this.advance(t.id);
    }
  }

  async pollStaging(): Promise<void> {
    const rows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.stage, "STAGING"), eq(tasks.status, "RUNNING")));
    await Promise.all(rows.map((r) => this.advance(r.id)));
  }
}

function humanRejectFeedback(feedback: string, reviews: ReviewRow[]): string {
  const findings = reviews
    .flatMap((r) => r.findings.map((f) => `- [${r.reviewer}] ${f.severity}: ${f.message}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : ""}`))
    .join("\n");
  return `Human reviewer feedback:\n${feedback}\n\nReviewer findings:\n${findings || "- (none)"}`;
}

function logSwallow(what: string) {
  return (e: unknown) => console.warn(`[reset] failed to ${what}:`, errorMessage(e));
}
