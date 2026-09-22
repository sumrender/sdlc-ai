import { z } from "zod";
import { FindingSchema, HumanReviewDecisionSchema, MaxConcurrentTasksSchema, ProjectSchema, VerdictSchema } from "./domain";
import { ProjectManifestSchema } from "./manifest";

export const CreateTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(10_000).default(""),
  issueRef: z.string().trim().min(1).max(300).optional(),
  pullRef: z.string().trim().min(1).max(300).optional(),
  force: z.boolean().optional(),
}).refine((v) => v.title || v.issueRef || v.pullRef, { message: "title or issueRef/pullRef is required" });
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

/**
 * Human moderation of a single agent Review. ACCEPTED means "valid, keep it"
 * (optional insights comment); REJECTED means "invalid, ignore it" (comment
 * required so anyone opening the Task sees why). Does not move the Task.
 */
export const DecideReviewInputSchema = z.object({
  decision: HumanReviewDecisionSchema,
  comment: z.string().trim().max(4_000).default(""),
}).refine((v) => v.decision !== "REJECTED" || v.comment.length > 0, {
  message: "A comment is required when marking a review invalid.",
  path: ["comment"],
});
export type DecideReviewInput = z.infer<typeof DecideReviewInputSchema>;

/** Curate a Review before sending it back: overwrite verdict and/or findings. */
export const UpdateReviewInputSchema = z.object({
  verdict: VerdictSchema.optional(),
  findings: z.array(FindingSchema).max(100).optional(),
}).refine((v) => v.verdict !== undefined || v.findings !== undefined, { message: "verdict or findings is required" });
export type UpdateReviewInput = z.infer<typeof UpdateReviewInputSchema>;

/**
 * Send one (possibly edited) Review back to the Developer. Applies the given
 * verdict/findings first when present, then rejects the pending Approval with
 * only this Review's findings plus the comment and moves to DEVELOPMENT.
 */
export const SendReviewBackInputSchema = z.object({
  comment: z.string().trim().max(10_000).default(""),
  verdict: VerdictSchema.optional(),
  findings: z.array(FindingSchema).max(100).optional(),
});
export type SendReviewBackInput = z.infer<typeof SendReviewBackInputSchema>;

/**
 * Body of DELETE /tasks/:id. Deleting a Task also stops it when runs are live;
 * these flags additionally close the Task's GitHub issue and/or pull request.
 */
export const DeleteTaskInputSchema = z.object({
  closeIssue: z.boolean().optional(),
  closePullRequest: z.boolean().optional(),
});
export type DeleteTaskInput = z.infer<typeof DeleteTaskInputSchema>;

/** Response of DELETE /tasks/:id: the removed Task plus how much GitHub cleanup happened. */
export const DeleteTaskResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  issuesClosed: z.number().int(),
  pullRequestsClosed: z.number().int(),
});
export type DeleteTaskResult = z.infer<typeof DeleteTaskResultSchema>;

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
export const DUPLICATE_TASK_ERROR_CODE = "DUPLICATE_TASK" as const;

/** Accepts "123", "#123", or a full GitHub issue/PR URL; returns the number or null. */
export function parseGitHubRef(ref: string): number | null {
  const trimmed = ref.trim();
  const urlMatch = trimmed.match(/github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/(\d+)/i);
  if (urlMatch) return Number(urlMatch[1]);
  const numMatch = trimmed.match(/^#?(\d+)$/);
  if (numMatch) return Number(numMatch[1]);
  return null;
}

/** REST and SSE paths, relative to the API origin. Shared so client and server never drift. */
export const API_PATHS = {
  health: "/health",
  tasks: "/tasks",
  task: (taskId: string) => `/tasks/${taskId}`,
  startTask: (taskId: string) => `/tasks/${taskId}/start`,
  retryTask: (taskId: string) => `/tasks/${taskId}/retry`,
  retryWithNewBranchTask: (taskId: string) => `/tasks/${taskId}/retry-with-new-branch`,
  sendBackTask: (taskId: string) => `/tasks/${taskId}/send-back`,
  stopTask: (taskId: string) => `/tasks/${taskId}/stop`,
  deleteTask: (taskId: string) => `/tasks/${taskId}`,
  answerQuestion: (taskId: string, questionId: string) => `/tasks/${taskId}/questions/${questionId}/answer`,
  decideApproval: (taskId: string, approvalId: string) => `/tasks/${taskId}/approvals/${approvalId}/decide`,
  decideReview: (taskId: string, reviewId: string) => `/tasks/${taskId}/reviews/${reviewId}/decision`,
  updateReview: (taskId: string, reviewId: string) => `/tasks/${taskId}/reviews/${reviewId}`,
  sendReviewBack: (taskId: string, reviewId: string) => `/tasks/${taskId}/reviews/${reviewId}/send-back`,
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

/**
 * Whether the Sandbox image on the Docker host was built from the Dockerfile currently on disk.
 * A stale image silently drops tooling (CHROME_BIN, opencode shims), so it is surfaced, never enforced.
 */
export const SandboxImageStatusSchema = z.object({
  ok: z.boolean(),
  warning: z.string().nullable(),
});
export type SandboxImageStatus = z.infer<typeof SandboxImageStatusSchema>;

/** Response of GET /project: everything the Settings page shows. Nothing here is hardcoded in the UI. */
export const ProjectSettingsSchema = z.object({
  project: ProjectSchema,
  github: GitHubConnectionSchema,
  manifest: ManifestReadSchema,
  deployProviders: z.object({ CLOUDFLARE: z.boolean(), RENDER: z.boolean() }),
  models: z.object({ developer: z.string(), fast: z.string() }),
  sandboxImage: z.string(),
  sandboxImageStatus: SandboxImageStatusSchema.default({ ok: true, warning: null }),
  fakes: z.boolean(),
  activeTask: z.object({ id: z.string(), title: z.string(), stage: z.string() }).nullable(),
  activeTasks: z.array(z.object({ id: z.string(), title: z.string(), stage: z.string() })).default([]),
  activeTaskCount: z.number().int().default(0),
  maxConcurrentTasks: MaxConcurrentTasksSchema.default(3),
  reuseSandbox: z.boolean().default(true),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
