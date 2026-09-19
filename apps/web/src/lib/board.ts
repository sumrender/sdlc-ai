import {
  AgentRunStartedPayloadSchema,
  ApprovalRequestedPayloadSchema,
  findBlockingTask,
  QuestionCreatedPayloadSchema,
  STAGES,
  TaskCreatedPayloadSchema,
  TaskStageChangedPayloadSchema,
  TaskStatusChangedPayloadSchema,
  type BoardTask,
  type Event,
  type Stage,
} from "@sdlc-ai/shared";

export interface StageColumn {
  stage: Stage;
  tasks: BoardTask[];
}

const byCreatedAt = (a: BoardTask, b: BoardTask) => a.createdAt.localeCompare(b.createdAt);

export function groupTasksByStage(tasks: readonly BoardTask[]): StageColumn[] {
  return STAGES.map((stage) => ({
    stage,
    tasks: tasks.filter((task) => task.stage === stage).sort(byCreatedAt),
  }));
}

export type StartAvailability = { allowed: true } | { allowed: false; reason: string };

export function startAvailability(tasks: readonly BoardTask[], candidate: BoardTask): StartAvailability {
  if (candidate.stage !== "TODO") {
    return { allowed: false, reason: "Only TODO Tasks can be started." };
  }
  const blocker = findBlockingTask(tasks, candidate.id);
  if (blocker) {
    return {
      allowed: false,
      reason: `Waiting for "${blocker.title}" to reach STAGING. One Task runs at a time.`,
    };
  }
  return { allowed: true };
}

export interface ApplyEventResult {
  tasks: BoardTask[];
  /** True when the list may be stale and should be refetched. */
  reconcile: boolean;
}

type Patch = (task: BoardTask) => BoardTask;

/** Returns a patch for the given Event, or null when its payload does not validate. */
function patchFor(event: Event): Patch | null | undefined {
  switch (event.type) {
    case "TASK_STAGE_CHANGED": {
      const parsed = TaskStageChangedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return null;
      const { to, status } = parsed.data;
      return (task) => ({
        ...task,
        stage: to,
        status,
        stageEnteredAt: event.createdAt,
        activeAgent: null,
        pendingQuestion: null,
        pendingApprovalId: null,
      });
    }
    case "TASK_STATUS_CHANGED": {
      const parsed = TaskStatusChangedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return null;
      const { status } = parsed.data;
      return (task) => ({ ...task, status, activeAgent: status === "RUNNING" ? task.activeAgent : null });
    }
    case "AGENT_RUN_STARTED": {
      const parsed = AgentRunStartedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return null;
      const { agent } = parsed.data;
      return (task) => ({ ...task, status: "RUNNING", activeAgent: agent });
    }
    case "AGENT_RUN_COMPLETED":
    case "AGENT_RUN_FAILED":
      return (task) => ({ ...task, activeAgent: null });
    case "QUESTION_CREATED": {
      const parsed = QuestionCreatedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return null;
      const { question } = parsed.data;
      return (task) => ({ ...task, status: "WAITING", activeAgent: null, pendingQuestion: question });
    }
    case "QUESTION_ANSWERED":
      return (task) => ({ ...task, pendingQuestion: null });
    case "APPROVAL_REQUESTED": {
      const parsed = ApprovalRequestedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return null;
      const { approvalId } = parsed.data;
      return (task) => ({ ...task, status: "WAITING", activeAgent: null, pendingApprovalId: approvalId });
    }
    case "APPROVAL_DECIDED":
      return (task) => ({ ...task, pendingApprovalId: null });
    default:
      return undefined;
  }
}

export function applyEventToTasks(tasks: readonly BoardTask[], event: Event): ApplyEventResult {
  const unchanged = { tasks: [...tasks], reconcile: true };

  if (event.type === "TASK_CREATED") {
    const parsed = TaskCreatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return unchanged;
    const created = parsed.data.task;
    const exists = tasks.some((task) => task.id === created.id);
    return { tasks: exists ? [...tasks] : [...tasks, created], reconcile: false };
  }

  const patch = patchFor(event);
  if (!patch) return unchanged;

  const index = tasks.findIndex((task) => task.id === event.taskId);
  if (index === -1) return unchanged;

  const next = [...tasks];
  next[index] = patch(tasks[index]!);
  return { tasks: next, reconcile: false };
}
