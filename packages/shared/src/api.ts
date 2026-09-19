import { z } from "zod";

export const CreateTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).default(""),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export const AnswerQuestionInputSchema = z.object({
  answer: z.string().trim().min(1).max(4_000),
});
export type AnswerQuestionInput = z.infer<typeof AnswerQuestionInputSchema>;

export const DecideApprovalInputSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("APPROVED") }),
  z.object({ decision: z.literal("REJECTED"), feedback: z.string().trim().min(1).max(10_000) }),
]);
export type DecideApprovalInput = z.infer<typeof DecideApprovalInputSchema>;

export const DEMO_TASK = {
  title: "Show the template count in the gallery header",
  description:
    "Display the total number of available templates in the gallery page header so users can see how many templates exist at a glance.",
} as const;

export const ApiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ResetDemoResultSchema = z.object({
  tasksDeleted: z.number().int(),
  issuesClosed: z.number().int(),
  pullRequestsClosed: z.number().int(),
  branchesDeleted: z.number().int(),
});
export type ResetDemoResult = z.infer<typeof ResetDemoResultSchema>;

/** REST and SSE paths, relative to the API origin. Shared so client and server never drift. */
export const API_PATHS = {
  health: "/health",
  tasks: "/tasks",
  task: (taskId: string) => `/tasks/${taskId}`,
  startTask: (taskId: string) => `/tasks/${taskId}/start`,
  retryTask: (taskId: string) => `/tasks/${taskId}/retry`,
  sendBackTask: (taskId: string) => `/tasks/${taskId}/send-back`,
  answerQuestion: (taskId: string, questionId: string) => `/tasks/${taskId}/questions/${questionId}/answer`,
  decideApproval: (taskId: string, approvalId: string) => `/tasks/${taskId}/approvals/${approvalId}/decide`,
  artifacts: (taskId: string) => `/tasks/${taskId}/artifacts`,
  artifactContent: (taskId: string, artifactId: string) => `/tasks/${taskId}/artifacts/${artifactId}/content`,
  project: "/project",
  manifest: "/project/manifest",
  runDemo: "/demo/run",
  resetDemo: "/demo/reset",
  events: "/events",
} as const;
