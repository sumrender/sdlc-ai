import {
  API_PATHS,
  ApiErrorSchema,
  BoardTaskListSchema,
  BoardTaskSchema,
  ProjectSettingsSchema,
  ResetDemoResultSchema,
  TaskDetailSchema,
  type AnswerQuestionInput,
  type BoardTask,
  type CreateTaskInput,
  type DecideApprovalInput,
  type ProjectSettings,
  type ResetDemoResult,
  type TaskDetail,
  type UpdateProjectSettingsInput,
} from "@sdlc-ai/shared";
import type { ZodType, ZodTypeDef } from "zod";

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
  listTasks(): Promise<BoardTask[]>;
  createTask(input: CreateTaskInput): Promise<BoardTask>;
  startTask(taskId: string): Promise<BoardTask>;
  answerQuestion(taskId: string, questionId: string, input: AnswerQuestionInput): Promise<BoardTask>;
  runDemo(): Promise<BoardTask>;
  resetDemo(): Promise<ResetDemoResult>;
  /** The Task with every Agent Run, Test Run, Question, Review, Approval, Deployment, Artifact, and Event. */
  getTask(taskId: string): Promise<TaskDetail>;
  retryTask(taskId: string): Promise<TaskDetail>;
  retryWithNewBranchTask(taskId: string): Promise<TaskDetail>;
  sendBackTask(taskId: string): Promise<TaskDetail>;
  /** The human's decision at HUMAN REVIEW. Returns the Task after the workflow engine has acted on it. */
  decideApproval(taskId: string, approvalId: string, input: DecideApprovalInput): Promise<TaskDetail>;
  /** The Project, its GitHub connection, Deploy Targets, and the Manifest as read from the repository. */
  getProjectSettings(): Promise<ProjectSettings>;
  /** Updates the max concurrent Tasks limit. Returns the refreshed Settings. */
  updateMaxConcurrentTasks(limit: number): Promise<ProjectSettings>;
  /** Toggles single-container reuse for a Task. Returns the refreshed Settings. */
  updateReuseSandbox(reuse: boolean): Promise<ProjectSettings>;
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
  /** Absolute URL of the SSE endpoint; scoped to one Task when `taskId` is given. */
  eventsUrl(taskId?: string): string;
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
    listTasks: () => request(API_PATHS.tasks, BoardTaskListSchema),
    createTask: (input) => post(API_PATHS.tasks, BoardTaskSchema, input),
    startTask: (taskId) => post(API_PATHS.startTask(taskId), BoardTaskSchema),
    answerQuestion: (taskId, questionId, input) => post(API_PATHS.answerQuestion(taskId, questionId), BoardTaskSchema, input),
    runDemo: () => post(API_PATHS.runDemo, BoardTaskSchema),
    resetDemo: () => post(API_PATHS.resetDemo, ResetDemoResultSchema, { confirm: true }),
    getTask: (taskId) => request(API_PATHS.task(taskId), TaskDetailSchema),
    retryTask: (taskId) => post(API_PATHS.retryTask(taskId), TaskDetailSchema),
    retryWithNewBranchTask: (taskId) => post(API_PATHS.retryWithNewBranchTask(taskId), TaskDetailSchema),
    sendBackTask: (taskId) => post(API_PATHS.sendBackTask(taskId), TaskDetailSchema),
    decideApproval: (taskId, approvalId, input) => post(API_PATHS.decideApproval(taskId, approvalId), TaskDetailSchema, input),
    getProjectSettings: () => request(API_PATHS.project, ProjectSettingsSchema),
    updateMaxConcurrentTasks: (limit: number) => {
      const body: UpdateProjectSettingsInput = { maxConcurrentTasks: limit };
      return request(API_PATHS.updateProjectSettings, ProjectSettingsSchema, { method: "PATCH", body: JSON.stringify(body) });
    },
    updateReuseSandbox: (reuse: boolean) => {
      const body: UpdateProjectSettingsInput = { reuseSandbox: reuse };
      return request(API_PATHS.updateProjectSettings, ProjectSettingsSchema, { method: "PATCH", body: JSON.stringify(body) });
    },
    fetchArtifactText: async (taskId, artifactId) => {
      const path = API_PATHS.artifactContent(taskId, artifactId);
      const res = await fetch(`${origin}${path}`);
      if (!res.ok) throw await toRequestError(res, path);
      return res.text();
    },
    artifactContentUrl: (taskId, artifactId) => `${origin}${API_PATHS.artifactContent(taskId, artifactId)}`,
    testRunReportUrl: (taskId, testRunId, filePath) => `${origin}${testRunReportPath(taskId, testRunId, filePath)}`,
    eventsUrl: (taskId) => `${origin}${API_PATHS.events}${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ""}`,
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
