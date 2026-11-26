import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ZodType, ZodTypeDef } from "zod";
import { API_PATHS } from "@sdlc-ai/shared";
import { HttpError } from "../errors.js";
import type { ProjectRegistry } from "../integrations/project-registry.js";
import type { WorkflowService } from "../pipeline/workflow.js";
import { eventRoutes } from "./events.js";
import { projectsRoutes } from "./projects.js";
import { taskRoutes } from "./tasks.js";

export function createApp(workflow: WorkflowService, registry: ProjectRegistry) {
  const app = new Hono();

  app.use("*", cors());

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json(err.code ? { error: err.message, code: err.code } : { error: err.message }, err.status as 400);
    if (isGitHubError(err)) {
      console.error(`[api] ${c.req.method} ${c.req.path} — GitHub ${err.status}: ${err.message}`);
      return c.json({ error: `GitHub rejected the request (${err.status}): ${err.message}. Check the Project's GitHub token and repository access.`, code: "GITHUB_ERROR" }, 502);
    }
    console.error(`[api] ${c.req.method} ${c.req.path}`, err);
    return c.json({ error: "Internal Server Error" }, 500);
  });
  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  app.get(API_PATHS.health, (c) => c.json({ ok: true, at: new Date().toISOString() }));
  app.route(API_PATHS.tasks, taskRoutes(workflow, workflow.deps.artifacts));
  app.route(API_PATHS.projects, projectsRoutes(workflow, registry));
  app.route(API_PATHS.events, eventRoutes());

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
