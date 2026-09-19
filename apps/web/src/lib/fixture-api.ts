import {
  DEMO_TASK,
  findBlockingTask,
  type Agent,
  type AnswerQuestionInput,
  type BoardTask,
  type CreateTaskInput,
  type Event,
  type EventType,
  type Question,
  type ResetDemoResult,
  type SseMessage,
  type Stage,
  type TaskStatus,
} from "@sdlc-ai/shared";
import { ApiRequestError, type ApiClient } from "./api";
import { applyEventToTasks } from "./board";
import type { EventSourceLike } from "./event-stream";

/**
 * An in-memory ApiClient plus a matching EventSource for running the board
 * before the backend exists (issue #1: "Kanban with fake Events first").
 * Selected with VITE_API_MODE=fixture. Starting a Task walks it through every
 * Stage on a timer, pausing on the Planner's Question and stopping at the
 * Approval. Events are applied to the store with the same code the board uses.
 */
export interface FixtureApi {
  client: ApiClient;
  createEventSource: (url: string) => EventSourceLike;
}

const STEP_MS = 1600;
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

declare global {
  interface Window {
    /** Dev helper: simulates the SSE connection dropping so reconnect can be observed. */
    sdlcFixture?: { dropConnection(): void };
  }
}

export function createFixtureApi(): FixtureApi {
  let tasks: BoardTask[] = seedTasks();
  const sources = new Set<FixtureEventSource>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const emit = (taskId: string, type: EventType, payload: Record<string, unknown>) => {
    const event: Event = { id: crypto.randomUUID(), taskId, type, payload, createdAt: now() };
    tasks = applyEventToTasks(tasks, event).tasks;
    const message: SseMessage = { kind: "event", event };
    for (const source of sources) source.deliver(message);
  };

  const after = (ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };

  const find = (taskId: string): BoardTask => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new ApiRequestError(404, `Task ${taskId} not found`, "NOT_FOUND");
    return task;
  };

  const moveTo = (taskId: string, to: Stage, status: TaskStatus) =>
    emit(taskId, "TASK_STAGE_CHANGED", { from: find(taskId).stage, to, status });
  const runAgent = (taskId: string, agent: Agent) =>
    emit(taskId, "AGENT_RUN_STARTED", { agentRunId: crypto.randomUUID(), agent });

  /** Steps run STEP_MS apart; a step returning false stops the sequence. */
  const sequence = (steps: Array<() => boolean | void>) => {
    const run = (index: number) => {
      const step = steps[index];
      if (!step) return;
      if (step() === false) return;
      after(STEP_MS, () => run(index + 1));
    };
    run(0);
  };

  const askQuestion = (taskId: string) => {
    const question: Question = {
      id: crypto.randomUUID(),
      taskId,
      agentRunId: crypto.randomUUID(),
      text: "Should the count include archived templates?",
      options: ["Only active templates", "Active and archived", "Show both counts"],
      status: "PENDING",
      answer: null,
      createdAt: now(),
      answeredAt: null,
    };
    emit(taskId, "QUESTION_CREATED", { question });
  };

  const developAndReview = (taskId: string) =>
    sequence([
      () => {
        moveTo(taskId, "DEVELOPMENT", "RUNNING");
        runAgent(taskId, "DEVELOPER");
      },
      () => moveTo(taskId, "E2E", "RUNNING"),
      () => {
        moveTo(taskId, "AGENT_REVIEW", "RUNNING");
        runAgent(taskId, "REVIEWER_SECURITY");
      },
      () => runAgent(taskId, "REVIEWER_ARCHITECTURE"),
      () => runAgent(taskId, "REVIEWER_QUALITY"),
      () => runAgent(taskId, "REVIEWER_PERFORMANCE"),
      () => {
        moveTo(taskId, "HUMAN_REVIEW", "READY");
        emit(taskId, "APPROVAL_REQUESTED", { approvalId: crypto.randomUUID() });
      },
    ]);

  const client: ApiClient = {
    listTasks: async () => tasks,
    createTask: async (input: CreateTaskInput) => {
      const task = makeTask(input);
      emit(task.id, "TASK_CREATED", { task });
      return task;
    },
    startTask: async (taskId) => {
      const task = find(taskId);
      if (task.stage !== "TODO") throw new ApiRequestError(409, "Only TODO Tasks can be started", "NOT_TODO");
      const blocker = findBlockingTask(tasks, taskId);
      if (blocker) throw new ApiRequestError(409, `"${blocker.title}" is still active`, "TASK_ACTIVE");
      sequence([
        () => {
          moveTo(taskId, "PLANNING", "RUNNING");
          runAgent(taskId, "PLANNER");
        },
        () => askQuestion(taskId),
      ]);
      return find(taskId);
    },
    answerQuestion: async (taskId, questionId, input: AnswerQuestionInput) => {
      const task = find(taskId);
      if (task.pendingQuestion?.id !== questionId) {
        throw new ApiRequestError(409, "That Question is no longer pending", "QUESTION_NOT_PENDING");
      }
      emit(taskId, "QUESTION_ANSWERED", { questionId, answer: input.answer });
      runAgent(taskId, "PLANNER");
      after(STEP_MS, () => developAndReview(taskId));
      return find(taskId);
    },
    runDemo: async () => {
      const task = await client.createTask({ ...DEMO_TASK });
      return client.startTask(task.id);
    },
    resetDemo: async (): Promise<ResetDemoResult> => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      const tasksDeleted = tasks.length;
      tasks = [];
      return { tasksDeleted, issuesClosed: tasksDeleted, pullRequestsClosed: 0, branchesDeleted: 0 };
    },
    eventsUrl: () => "fixture://events",
  };

  const createEventSource = () => {
    const source = new FixtureEventSource(() => sources.delete(source));
    sources.add(source);
    return source;
  };

  if (typeof window !== "undefined") {
    window.sdlcFixture = { dropConnection: () => sources.forEach((s) => s.drop()) };
  }

  return { client, createEventSource };
}

class FixtureEventSource implements EventSourceLike {
  readyState: number = CONNECTING;
  onopen: EventSource["onopen"] = null;
  onmessage: EventSource["onmessage"] = null;
  onerror: EventSource["onerror"] = null;

  constructor(private readonly onClose: () => void) {
    queueMicrotask(() => {
      if (this.readyState !== CONNECTING) return;
      this.readyState = OPEN;
      this.onopen?.call(this.asEventSource(), new Event("open"));
    });
  }

  deliver(message: SseMessage) {
    if (this.readyState !== OPEN) return;
    this.onmessage?.call(this.asEventSource(), new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  /** Simulates the server dropping the connection for good; the client opens a new source. */
  drop() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.onerror?.call(this.asEventSource(), new Event("error"));
  }

  close() {
    this.readyState = CLOSED;
    this.onClose();
  }

  private asEventSource(): EventSource {
    return this as unknown as EventSource;
  }
}

const now = () => new Date().toISOString();

function makeTask(input: CreateTaskInput, overrides: Partial<BoardTask> = {}): BoardTask {
  const at = now();
  return {
    id: crypto.randomUUID(),
    projectId: "fixture-project",
    title: input.title,
    description: input.description,
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
    stageEnteredAt: at,
    createdAt: at,
    updatedAt: at,
    activeAgent: null,
    pendingQuestion: null,
    pendingApprovalId: null,
    ...overrides,
  };
}

function seedTasks(): BoardTask[] {
  return [
    makeTask(
      { title: "Add dark mode toggle to the settings page", description: "" },
      { stage: "STAGING", status: "COMPLETED", createdAt: "2026-09-18T09:00:00.000Z" },
    ),
    makeTask({ title: "Fix flaky template search on empty query", description: "" }, { createdAt: "2026-09-18T10:00:00.000Z" }),
    makeTask({ title: "Paginate the template gallery", description: "" }, { createdAt: "2026-09-18T11:00:00.000Z" }),
  ];
}
