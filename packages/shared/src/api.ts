import { z } from "zod";
import { MaxConcurrentTasksSchema, ProjectSchema } from "./domain";
import { ProjectManifestSchema } from "./manifest";

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

export const UpdateProjectSettingsInputSchema = z.object({
  maxConcurrentTasks: MaxConcurrentTasksSchema.optional(),
  reuseSandbox: z.boolean().optional(),
});
export type UpdateProjectSettingsInput = z.infer<typeof UpdateProjectSettingsInputSchema>;

export const MAX_CONCURRENT_TASKS_ERROR_CODE = "MAX_CONCURRENT_TASKS" as const;

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
  updateProjectSettings: "/project/settings",
  manifest: "/project/manifest",
  runDemo: "/demo/run",
  resetDemo: "/demo/reset",
  events: "/events",
} as const;

// ---- Settings -------------------------------------------------------------

export const GitHubConnectionSchema = z.object({
  ok: z.boolean(),
  login: z.string().optional(),
  error: z.string().optional(),
});
export type GitHubConnection = z.infer<typeof GitHubConnectionSchema>;

/** The Project Manifest as read from the repository, or why it could not be. */
export const ManifestReadSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), manifest: ProjectManifestSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type ManifestRead = z.infer<typeof ManifestReadSchema>;

/** Response of GET /project: everything the Settings page shows. Nothing here is hardcoded in the UI. */
export const ProjectSettingsSchema = z.object({
  project: ProjectSchema,
  github: GitHubConnectionSchema,
  manifest: ManifestReadSchema,
  deployProviders: z.object({ CLOUDFLARE: z.boolean(), RENDER: z.boolean() }),
  models: z.object({ developer: z.string(), fast: z.string() }),
  sandboxImage: z.string(),
  fakes: z.boolean(),
  activeTask: z.object({ id: z.string(), title: z.string(), stage: z.string() }).nullable(),
  activeTasks: z.array(z.object({ id: z.string(), title: z.string(), stage: z.string() })).default([]),
  activeTaskCount: z.number().int().default(0),
  maxConcurrentTasks: MaxConcurrentTasksSchema.default(3),
  reuseSandbox: z.boolean().default(true),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
