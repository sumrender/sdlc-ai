import {
  API_PATHS,
  ApiErrorSchema,
  BoardTaskListSchema,
  BoardTaskSchema,
  ResetDemoResultSchema,
  type AnswerQuestionInput,
  type BoardTask,
  type CreateTaskInput,
  type ResetDemoResult,
} from "@sdlc-ai/shared";
import type { ZodType } from "zod";

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
  /** Absolute URL of the SSE endpoint. */
  eventsUrl(): string;
}

export interface ApiClientOptions {
  origin: string;
  fetch?: typeof globalThis.fetch;
}

export function createApiClient({ origin, fetch = globalThis.fetch }: ApiClientOptions): ApiClient {
  async function request<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
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

  const post = <T>(path: string, schema: ZodType<T>, body?: unknown) =>
    request(path, schema, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

  return {
    listTasks: () => request(API_PATHS.tasks, BoardTaskListSchema),
    createTask: (input) => post(API_PATHS.tasks, BoardTaskSchema, input),
    startTask: (taskId) => post(API_PATHS.startTask(taskId), BoardTaskSchema),
    answerQuestion: (taskId, questionId, input) => post(API_PATHS.answerQuestion(taskId, questionId), BoardTaskSchema, input),
    runDemo: () => post(API_PATHS.runDemo, BoardTaskSchema),
    resetDemo: () => post(API_PATHS.resetDemo, ResetDemoResultSchema),
    eventsUrl: () => `${origin}${API_PATHS.events}`,
  };
}

async function toRequestError(res: Response, path: string): Promise<ApiRequestError> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) return new ApiRequestError(res.status, parsed.data.error, parsed.data.code);
  return new ApiRequestError(res.status, `${res.status} ${path}`);
}

export const BE_ORIGIN = import.meta.env.VITE_BE_ORIGIN ?? "http://localhost:4000";
