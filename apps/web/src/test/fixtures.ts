import type { BoardTask, Event, EventType, Question } from "@sdlc-ai/shared";

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;
const AT = "2026-09-19T08:00:00.000Z";

export function boardTask(overrides: Partial<BoardTask> = {}): BoardTask {
  const id = overrides.id ?? nextId("task");
  return {
    id,
    projectId: "project-1",
    title: `Task ${id}`,
    description: "",
    stage: "TODO",
    status: "READY",
    plan: null,
    issueNumber: null,
    issueUrl: null,
    branchName: null,
    pullRequestNumber: null,
    pullRequestUrl: null,
    mergedCommitSha: null,
    e2eRejectLoopUsed: false,
    pendingFeedback: null,
    error: null,
    stageEnteredAt: AT,
    createdAt: AT,
    updatedAt: AT,
    activeAgent: null,
    pendingQuestion: null,
    pendingApprovalId: null,
    ...overrides,
  };
}

export function question(taskId: string, overrides: Partial<Question> = {}): Question {
  return {
    id: nextId("question"),
    taskId,
    agentRunId: "run-1",
    text: "Which header should show the count?",
    options: null,
    status: "PENDING",
    answer: null,
    createdAt: AT,
    answeredAt: null,
    ...overrides,
  };
}

export function event(taskId: string, type: EventType, payload: Record<string, unknown> = {}): Event {
  return { id: nextId("event"), taskId, type, payload, createdAt: AT };
}
