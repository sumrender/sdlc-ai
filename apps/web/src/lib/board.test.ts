import { describe, expect, it } from "vitest";
import { applyEventToTasks, groupTasksByStage, startAvailability } from "./board";
import { boardTask, event, question } from "~/test/fixtures";

describe("groupTasksByStage", () => {
  it("returns the seven Stages in pipeline order, each with its Tasks", () => {
    const todo = boardTask({ stage: "TODO" });
    const dev = boardTask({ stage: "DEVELOPMENT" });
    const staging = boardTask({ stage: "STAGING", status: "COMPLETED" });

    const columns = groupTasksByStage([staging, dev, todo]);

    expect(columns.map((c) => c.stage)).toEqual([
      "TODO",
      "PLANNING",
      "DEVELOPMENT",
      "E2E",
      "AGENT_REVIEW",
      "HUMAN_REVIEW",
      "STAGING",
    ]);
    expect(columns[0]?.tasks).toEqual([todo]);
    expect(columns[1]?.tasks).toEqual([]);
    expect(columns[2]?.tasks).toEqual([dev]);
    expect(columns[6]?.tasks).toEqual([staging]);
  });

  it("orders Tasks within a column by creation time, oldest first", () => {
    const newer = boardTask({ stage: "TODO", createdAt: "2026-09-19T09:00:00.000Z" });
    const older = boardTask({ stage: "TODO", createdAt: "2026-09-19T07:00:00.000Z" });

    const [todo] = groupTasksByStage([newer, older]);

    expect(todo?.tasks.map((t) => t.id)).toEqual([older.id, newer.id]);
  });
});

describe("startAvailability", () => {
  it("allows Start when no other Task is active", () => {
    const candidate = boardTask({ stage: "TODO" });
    const staged = boardTask({ stage: "STAGING", status: "RUNNING", title: "Deploying" });

    expect(startAvailability([candidate, staged], candidate)).toEqual({ allowed: true });
  });

  it("refuses Start while another Task is between PLANNING and HUMAN_REVIEW, naming it", () => {
    const candidate = boardTask({ stage: "TODO" });
    const active = boardTask({ stage: "E2E", status: "RUNNING", title: "Add login" });

    expect(startAvailability([candidate, active], candidate)).toEqual({
      allowed: false,
      reason: 'Waiting for "Add login" to reach STAGING. One Task runs at a time.',
    });
  });

  it("refuses Start for a Task that is not in TODO", () => {
    const planning = boardTask({ stage: "PLANNING", status: "RUNNING" });

    expect(startAvailability([planning], planning)).toEqual({
      allowed: false,
      reason: "Only TODO Tasks can be started.",
    });
  });
});

describe("applyEventToTasks", () => {
  it("moves a Task to the Stage in TASK_STAGE_CHANGED and clears the previous Stage's activity", () => {
    const task = boardTask({ stage: "PLANNING", status: "RUNNING", activeAgent: "PLANNER" });
    const e = event(task.id, "TASK_STAGE_CHANGED", { from: "PLANNING", to: "DEVELOPMENT", status: "READY" });

    const result = applyEventToTasks([task], e);

    expect(result.reconcile).toBe(false);
    expect(result.tasks[0]).toMatchObject({ stage: "DEVELOPMENT", status: "READY", activeAgent: null });
  });

  it("marks the active Agent on AGENT_RUN_STARTED and clears it on AGENT_RUN_COMPLETED", () => {
    const task = boardTask({ stage: "DEVELOPMENT" });

    const started = applyEventToTasks([task], event(task.id, "AGENT_RUN_STARTED", { agentRunId: "run-9", agent: "DEVELOPER" }));
    expect(started.tasks[0]).toMatchObject({ status: "RUNNING", activeAgent: "DEVELOPER" });

    const completed = applyEventToTasks(started.tasks, event(task.id, "AGENT_RUN_COMPLETED", { agentRunId: "run-9" }));
    expect(completed.tasks[0]?.activeAgent).toBeNull();
  });

  it("attaches the pending Question and sets WAITING on QUESTION_CREATED, and detaches it on QUESTION_ANSWERED", () => {
    const task = boardTask({ stage: "PLANNING", status: "RUNNING", activeAgent: "PLANNER" });
    const q = question(task.id, { options: ["Gallery header", "Sidebar"] });

    const asked = applyEventToTasks([task], event(task.id, "QUESTION_CREATED", { question: q }));
    expect(asked.tasks[0]).toMatchObject({ status: "WAITING", pendingQuestion: q, activeAgent: null });

    const answered = applyEventToTasks(asked.tasks, event(task.id, "QUESTION_ANSWERED", { questionId: q.id }));
    expect(answered.tasks[0]?.pendingQuestion).toBeNull();
  });

  it("records the pending Approval on APPROVAL_REQUESTED and clears it on APPROVAL_DECIDED", () => {
    const task = boardTask({ stage: "HUMAN_REVIEW" });

    const requested = applyEventToTasks([task], event(task.id, "APPROVAL_REQUESTED", { approvalId: "approval-1" }));
    expect(requested.tasks[0]).toMatchObject({ status: "WAITING", pendingApprovalId: "approval-1" });

    const decided = applyEventToTasks(requested.tasks, event(task.id, "APPROVAL_DECIDED", { approvalId: "approval-1", decision: "APPROVED" }));
    expect(decided.tasks[0]?.pendingApprovalId).toBeNull();
  });

  it("adds the Task carried by TASK_CREATED once", () => {
    const existing = boardTask();
    const created = boardTask({ title: "New one" });
    const e = event(created.id, "TASK_CREATED", { task: created });

    const once = applyEventToTasks([existing], e);
    const twice = applyEventToTasks(once.tasks, e);

    expect(twice.tasks.map((t) => t.id)).toEqual([existing.id, created.id]);
    expect(twice.reconcile).toBe(false);
  });

  it("asks for a reconcile when the Event's Task is unknown or its payload is malformed", () => {
    const task = boardTask();

    const unknown = applyEventToTasks([task], event("task-missing", "TASK_STATUS_CHANGED", { status: "FAILED" }));
    expect(unknown).toEqual({ tasks: [task], reconcile: true });

    const malformed = applyEventToTasks([task], event(task.id, "TASK_STAGE_CHANGED", { to: "NOWHERE" }));
    expect(malformed).toEqual({ tasks: [task], reconcile: true });
  });

  it("leaves the list alone but asks for a reconcile on Events it does not apply", () => {
    const task = boardTask({ stage: "DEVELOPMENT", status: "RUNNING" });

    expect(applyEventToTasks([task], event(task.id, "PR_CREATED", { number: 12 }))).toEqual({ tasks: [task], reconcile: true });
  });
});
