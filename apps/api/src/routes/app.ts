import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ZodType, ZodTypeDef } from "zod";
import { API_PATHS } from "@sdlc-ai/shared";
import { HttpError } from "../errors.js";
import type { WorkflowService } from "../pipeline/workflow.js";
import { eventRoutes } from "./events.js";
import { projectRoutes } from "./project.js";
import { taskRoutes } from "./tasks.js";

export function createApp(workflow: WorkflowService) {
  const app = new Hono();

  app.use("*", cors());

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    if (isGitHubError(err)) {
      console.error(`[api] ${c.req.method} ${c.req.path} — GitHub ${err.status}: ${err.message}`);
      return c.json({ error: `GitHub rejected the request (${err.status}): ${err.message}. Check GITHUB_TOKEN and its access to the Project repository.`, code: "GITHUB_ERROR" }, 502);
    }
    console.error(`[api] ${c.req.method} ${c.req.path}`, err);
    return c.json({ error: "Internal Server Error" }, 500);
  });
  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  app.get(API_PATHS.health, (c) => c.json({ ok: true, at: new Date().toISOString() }));
  app.route(API_PATHS.tasks, taskRoutes(workflow, workflow.deps.artifacts));
  app.route(API_PATHS.project, projectRoutes(workflow));
  app.route(API_PATHS.events, eventRoutes());
  app.post(API_PATHS.runDemo, async (c) => {
    const task = await workflow.runDemo();
    return c.json(await workflow.boardTask(task.id), 201);
  });
  app.post(API_PATHS.resetDemo, async (c) => {
    const body = await readJson(c.req.raw);
    if ((body as { confirm?: unknown })?.confirm !== true) throw new HttpError(400, 'Reset requires { "confirm": true }');
    return c.json(await workflow.resetDemo());
  });

  return app;
}

// Octokit throws RequestError with a numeric status and the failing request attached.
function isGitHubError(err: unknown): err is Error & { status: number } {
  return err instanceof Error && typeof (err as { status?: unknown }).status === "number" && "request" in err;
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body must be valid JSON");
  }
}

export async function parseBody<T>(request: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  const result = schema.safeParse(await readJson(request));
  if (!result.success) {
    throw new HttpError(400, result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return result.data;
}
