import { z } from "zod";
import {
  ACTIVE_STAGES,
  AgentSchema,
  QuestionSchema,
  type Stage,
  StageSchema,
  TaskSchema,
  TaskStatusSchema,
} from "./domain";

/**
 * The shape the Kanban renders one card from. It is the Task plus the three
 * facts a card needs that live on other entities: which Agent is running,
 * and which Question or Approval a WAITING card is blocked on.
 * The list Tasks endpoint returns `BoardTask[]`.
 */
export const BoardTaskSchema = TaskSchema.extend({
  activeAgent: AgentSchema.nullable(),
  pendingQuestion: QuestionSchema.nullable(),
  pendingApprovalId: z.string().nullable(),
});
export type BoardTask = z.infer<typeof BoardTaskSchema>;

export const BoardTaskListSchema = z.array(BoardTaskSchema);

/** A Task is active while it is between PLANNING and HUMAN_REVIEW inclusive. STAGING does not block. */
export function isActiveStage(stage: Stage): boolean {
  return (ACTIVE_STAGES as readonly Stage[]).includes(stage);
}

/**
 * Start is refused while the number of other active Tasks reaches the
 * configured limit. Returns the Tasks that block Start (empty when allowed).
 * Shared so the API's refusal and the board's Start button apply the same rule.
 */
export function findBlockingTasks<T extends Pick<BoardTask, "id" | "stage">>(
  tasks: readonly T[],
  candidateId: string,
  limit = 1,
): T[] {
  const active = tasks.filter((task) => task.id !== candidateId && isActiveStage(task.stage));
  return active.length >= limit ? active : [];
}

/**
 * Start is refused while any other Task is active. Returns the Task that
 * blocks Start, or null when Start is allowed. Shared so the API's refusal
 * and the board's disabled Start button apply the same rule.
 */
export function findBlockingTask<T extends Pick<BoardTask, "id" | "stage">>(
  tasks: readonly T[],
  candidateId: string,
): T | null {
  return findBlockingTasks(tasks, candidateId, 1)[0] ?? null;
}

// Payloads of the Events the board applies to its cache. Other Event types
// carry free-form payloads and the board treats them as "something changed".

export const TaskStageChangedPayloadSchema = z.object({
  from: StageSchema,
  to: StageSchema,
  status: TaskStatusSchema,
});
export type TaskStageChangedPayload = z.infer<typeof TaskStageChangedPayloadSchema>;

export const TaskStatusChangedPayloadSchema = z.object({
  status: TaskStatusSchema,
});
export type TaskStatusChangedPayload = z.infer<typeof TaskStatusChangedPayloadSchema>;

export const AgentRunStartedPayloadSchema = z.object({
  agentRunId: z.string(),
  agent: AgentSchema,
  attempt: z.number().int().optional(),
  model: z.string().optional(),
});
export type AgentRunStartedPayload = z.infer<typeof AgentRunStartedPayloadSchema>;

export const QuestionCreatedPayloadSchema = z.object({
  question: QuestionSchema,
});
export type QuestionCreatedPayload = z.infer<typeof QuestionCreatedPayloadSchema>;

export const ApprovalRequestedPayloadSchema = z.object({
  approvalId: z.string(),
});
export type ApprovalRequestedPayload = z.infer<typeof ApprovalRequestedPayloadSchema>;

export const TaskCreatedPayloadSchema = z.object({
  task: BoardTaskSchema,
});
export type TaskCreatedPayload = z.infer<typeof TaskCreatedPayloadSchema>;

export const ApprovalDecidedPayloadSchema = z.object({
  approvalId: z.string(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  feedback: z.string().nullable().optional(),
});
export type ApprovalDecidedPayload = z.infer<typeof ApprovalDecidedPayloadSchema>;

export const E2ECoverageDecidedPayloadSchema = z.object({
  covered: z.boolean(),
  generatedSpecPath: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
});
export type E2ECoverageDecidedPayload = z.infer<typeof E2ECoverageDecidedPayloadSchema>;

export const PRCommentPostedPayloadSchema = z.object({
  url: z.string(),
  videoUrl: z.string().nullable().optional(),
  testRunId: z.string().nullable().optional(),
});
export type PRCommentPostedPayload = z.infer<typeof PRCommentPostedPayloadSchema>;
