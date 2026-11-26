import {
  API_PATHS,
  ApiErrorSchema,
  BoardTaskListSchema,
  BoardTaskSchema,
  DeleteProjectResultSchema,
  DeleteTaskResultSchema,
  GitHubConnectionSchema,
  ProjectSettingsSchema,
  ProjectSummaryListSchema,
  ResetDemoResultSchema,
  SecretMetaSchema,
  TaskDetailSchema,
  type AnswerQuestionInput,
  type BoardTask,
  type CreateProjectInputRaw,
  type CreateTaskInput,
  type DecideApprovalInput,
  type DecideReviewInput,
  type DeleteProjectResult,
  type DeleteTaskInput,
  type DeleteTaskResult,
  type GitHubConnection,
  type ProjectSettings,
  type ProjectSummary,
  type ResetDemoResult,
  type SecretMeta,
  type SendReviewBackInput,
  type TaskDetail,
  type TestConnectionInput,
  type UpdateProjectInputRaw,
  type UpdateProjectSettingsInput,
  type UpdateReviewInput,
  type UpsertSecretInput,
} from "@sdlc-ai/shared";
import { z, type ZodType, type ZodTypeDef } from "zod";

const DeleteSecretResponseSchema = z.object({ ok: z.literal(true) });

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export interface ApiClient {
  listProjects(): Promise<ProjectSummary[]>;
  testProjectConnection(input: TestConnectionInput): Promise<GitHubConnection>;
  createProject(input: CreateProjectInputRaw): Promise<ProjectSettings>;
  updateProject(projectId: string, input: UpdateProjectInputRaw): Promise<ProjectSettings>;
  archiveProject(projectId: string): Promise<ProjectSettings>;
  restoreProject(projectId: string): Promise<ProjectSettings>;
  deleteProject(projectId: string): Promise<DeleteProjectResult>;
  upsertProjectSecret(projectId: string, name: string, input: UpsertSecretInput): Promise<SecretMeta>;
  deleteProjectSecret(projectId: string, name: string): Promise<void>;
  listTasks(projectId: string): Promise<BoardTask[]>;
  createTask(input: CreateTaskInput): Promise<BoardTask>;
  startTask(taskId: string): Promise<BoardTask>;
  answerQuestion(taskId: string, questionId: string, input: AnswerQuestionInput): Promise<BoardTask>;
  runDemo(projectId: string): Promise<BoardTask>;
  resetDemo(projectId: string): Promise<ResetDemoResult>;
  /** The Task with every Agent Run, Test Run, Question, Review, Approval, Deployment, Artifact, and Event. */
  getTask(taskId: string): Promise<TaskDetail>;
  retryTask(taskId: string): Promise<TaskDetail>;
  retryWithNewBranchTask(taskId: string): Promise<TaskDetail>;
  sendBackTask(taskId: string): Promise<TaskDetail>;
  /** Cancels the Task's live runs and parks it FAILED with "Stopped by operator". */
  stopTask(taskId: string): Promise<TaskDetail>;
  /** Deletes the Task (stopping it first), optionally closing its GitHub issue/PR. */
  deleteTask(taskId: string, input: DeleteTaskInput): Promise<DeleteTaskResult>;
  /** The human's decision at HUMAN REVIEW. Returns the Task after the workflow engine has acted on it. */
  decideApproval(taskId: string, approvalId: string, input: DecideApprovalInput): Promise<TaskDetail>;
  /** Accept a Review as valid or reject it as invalid, with a comment. Persists on the Review; never moves the Task. */
  decideReview(taskId: string, reviewId: string, input: DecideReviewInput): Promise<TaskDetail>;
  /** Curate a Review's verdict/findings. Persists on the Review; never moves the Task. */
  updateReview(taskId: string, reviewId: string, input: UpdateReviewInput): Promise<TaskDetail>;
  /** Send one (possibly edited) Review back to the Developer. Rejects the pending Approval and moves to DEVELOPMENT. */
  sendReviewBack(taskId: string, reviewId: string, input: SendReviewBackInput): Promise<TaskDetail>;
  /** The Project, its GitHub connection, Deploy Targets, Secrets hints, and DB-backed Manifest. */
  getProjectSettings(projectId: string): Promise<ProjectSettings>;
  /** Updates the max concurrent Tasks limit. Returns the refreshed Settings. */
  updateMaxConcurrentTasks(projectId: string, limit: number): Promise<ProjectSettings>;
  /** Toggles single-container reuse for a Task. Returns the refreshed Settings. */
  updateReuseSandbox(projectId: string, reuse: boolean): Promise<ProjectSettings>;
  /** Reads a text Artifact (a LOG or DIFF) in full. */
  fetchArtifactText(taskId: string, artifactId: string): Promise<string>;
  /** Absolute URL that streams an Artifact's bytes; used for images, reports, and downloads. */
  artifactContentUrl(taskId: string, artifactId: string): string;
  /**
   * Absolute URL of one file inside a Test Run's Playwright report directory.
   * Unlike `artifactContentUrl` this keeps the report's own directory shape, so
   * the relative `data/*.webm` attachment links inside the report HTML resolve.
   */
  testRunReportUrl(taskId: string, testRunId: string, filePath: string): string;
  /** Absolute URL of the SSE endpoint; optionally scoped by `projectId` and/or `taskId`. */
  eventsUrl(scope?: { projectId?: string; taskId?: string }): string;
}

export interface ApiClientOptions {
  origin: string;
  fetch?: typeof globalThis.fetch;
}

export function createApiClient({ origin, fetch = globalThis.fetch }: ApiClientOptions): ApiClient {
  async function request<T>(path: string, schema: ZodType<T, ZodTypeDef, unknown>, init?: RequestInit): Promise<T> {
    const res = await fetch(`${origin}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
    if (!res.ok) throw await toRequestError(res, path);
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) {
      throw new Error(`Invalid response from ${path}: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
    }
    return parsed.data;
  }

  const post = <T>(path: string, schema: ZodType<T, ZodTypeDef, unknown>, body?: unknown) =>
    request(path, schema, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

  return {
    listProjects: () => request(API_PATHS.projects, ProjectSummaryListSchema),
    testProjectConnection: (input) => post(API_PATHS.testProjectConnection, GitHubConnectionSchema, input),
    createProject: (input) => post(API_PATHS.projects, ProjectSettingsSchema, input),
    updateProject: (projectId, input) =>
      request(API_PATHS.updateProject(projectId), ProjectSettingsSchema, { method: "PATCH", body: JSON.stringify(input) }),
    archiveProject: (projectId) => post(API_PATHS.archiveProject(projectId), ProjectSettingsSchema),
    restoreProject: (projectId) => post(API_PATHS.restoreProject(projectId), ProjectSettingsSchema),
    deleteProject: (projectId) => request(API_PATHS.deleteProject(projectId), DeleteProjectResultSchema, { method: "DELETE" }),
    upsertProjectSecret: (projectId, name, input) =>
      request(API_PATHS.upsertProjectSecret(projectId, name), SecretMetaSchema, { method: "PUT", body: JSON.stringify(input) }),
    deleteProjectSecret: async (projectId, name) => {
      await request(API_PATHS.deleteProjectSecret(projectId, name), DeleteSecretResponseSchema, { method: "DELETE" });
    },
    listTasks: (projectId) => request(`${API_PATHS.tasks}?projectId=${encodeURIComponent(projectId)}`, BoardTaskListSchema),
    createTask: (input) => post(API_PATHS.tasks, BoardTaskSchema, input),
    startTask: (taskId) => post(API_PATHS.startTask(taskId), BoardTaskSchema),
    answerQuestion: (taskId, questionId, input) => post(API_PATHS.answerQuestion(taskId, questionId), BoardTaskSchema, input),
    runDemo: (projectId) => post(API_PATHS.runDemo(projectId), BoardTaskSchema),
    resetDemo: (projectId) => post(API_PATHS.resetDemo(projectId), ResetDemoResultSchema, { confirm: true }),
    getTask: (taskId) => request(API_PATHS.task(taskId), TaskDetailSchema),
    retryTask: (taskId) => post(API_PATHS.retryTask(taskId), TaskDetailSchema),
    retryWithNewBranchTask: (taskId) => post(API_PATHS.retryWithNewBranchTask(taskId), TaskDetailSchema),
    sendBackTask: (taskId) => post(API_PATHS.sendBackTask(taskId), TaskDetailSchema),
    stopTask: (taskId) => post(API_PATHS.stopTask(taskId), TaskDetailSchema),
    deleteTask: (taskId, input) => request(API_PATHS.deleteTask(taskId), DeleteTaskResultSchema, { method: "DELETE", body: JSON.stringify(input) }),
    decideApproval: (taskId, approvalId, input) => post(API_PATHS.decideApproval(taskId, approvalId), TaskDetailSchema, input),
    decideReview: (taskId, reviewId, input) => post(API_PATHS.decideReview(taskId, reviewId), TaskDetailSchema, input),
    updateReview: (taskId, reviewId, input) => request(API_PATHS.updateReview(taskId, reviewId), TaskDetailSchema, { method: "PATCH", body: JSON.stringify(input) }),
    sendReviewBack: (taskId, reviewId, input) => post(API_PATHS.sendReviewBack(taskId, reviewId), TaskDetailSchema, input),
    getProjectSettings: (projectId) => request(API_PATHS.project(projectId), ProjectSettingsSchema),
    updateMaxConcurrentTasks: (projectId, limit) => {
      const body: UpdateProjectSettingsInput = { maxConcurrentTasks: limit };
      return request(API_PATHS.updateProjectSettings(projectId), ProjectSettingsSchema, { method: "PATCH", body: JSON.stringify(body) });
    },
    updateReuseSandbox: (projectId, reuse) => {
      const body: UpdateProjectSettingsInput = { reuseSandbox: reuse };
      return request(API_PATHS.updateProjectSettings(projectId), ProjectSettingsSchema, { method: "PATCH", body: JSON.stringify(body) });
    },
    fetchArtifactText: async (taskId, artifactId) => {
      const path = API_PATHS.artifactContent(taskId, artifactId);
      const res = await fetch(`${origin}${path}`);
      if (!res.ok) throw await toRequestError(res, path);
      return res.text();
    },
    artifactContentUrl: (taskId, artifactId) => `${origin}${API_PATHS.artifactContent(taskId, artifactId)}`,
    testRunReportUrl: (taskId, testRunId, filePath) => `${origin}${testRunReportPath(taskId, testRunId, filePath)}`,
    eventsUrl: (scope) => {
      const params = new URLSearchParams();
      if (scope?.projectId) params.set("projectId", scope.projectId);
      if (scope?.taskId) params.set("taskId", scope.taskId);
      const qs = params.toString();
      return `${origin}${API_PATHS.events}${qs ? `?${qs}` : ""}`;
    },
  };
}

/**
 * Path of the Test Run report route. Not in the shared `API_PATHS` table because
 * the trailing segment is a whole sub-path, not one id: each segment is encoded
 * individually so the `/` separators survive into the server's wildcard capture.
 */
function testRunReportPath(taskId: string, testRunId: string, filePath: string): string {
  const encoded = filePath
    .split("/")
    .filter((s) => s.length > 0)
    .map(encodeURIComponent)
    .join("/");
  return `/tasks/${encodeURIComponent(taskId)}/test-runs/${encodeURIComponent(testRunId)}/report/${encoded}`;
}

async function toRequestError(res: Response, path: string): Promise<ApiRequestError> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) return new ApiRequestError(res.status, parsed.data.error, parsed.data.code);
  return new ApiRequestError(res.status, `${res.status} ${path}`);
}

export const BE_ORIGIN = import.meta.env.VITE_BE_ORIGIN ?? "http://localhost:4000";

/**
 * Fixture mode is strictly opt-in: only an explicit VITE_API_MODE=fixture
 * selects the in-memory demo client. Anything else — unset, empty, or any
 * other value — talks to the live API at BE_ORIGIN, so a cleared database
 * shows an empty board instead of demo Tasks.
 */
export function isFixtureMode(): boolean {
  return (import.meta.env.VITE_API_MODE ?? "").trim().toLowerCase() === "fixture";
}
