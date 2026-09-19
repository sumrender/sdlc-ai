import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ZodType, ZodTypeDef } from "zod";
import { HttpError } from "../errors.js";
import type { WorkflowService } from "../pipeline/workflow.js";
import { artifactRoutes } from "./artifacts.js";
import { eventRoutes } from "./events.js";
import { projectRoutes } from "./project.js";
import { approvalRoutes, questionRoutes, taskRoutes } from "./tasks.js";

export function createApp(workflow: WorkflowService) {
  const app = new Hono();

  app.use("*", cors());

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    console.error(`[api] ${c.req.method} ${c.req.path}`, err);
    return c.json({ error: "Internal Server Error" }, 500);
  });
  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  app.get("/health", (c) => c.json({ ok: true, at: new Date().toISOString() }));
  app.route("/tasks", taskRoutes(workflow));
  app.route("/questions", questionRoutes(workflow));
  app.route("/approvals", approvalRoutes(workflow));
  app.route("/project", projectRoutes(workflow));
  app.route("/artifacts", artifactRoutes(workflow.deps.artifacts));
  app.route("/events", eventRoutes());
  app.post("/demo/run", async (c) => c.json(await workflow.runDemo(), 201));
  app.post("/demo/reset", async (c) => {
    const body = await readJson(c.req.raw);
    if ((body as { confirm?: unknown })?.confirm !== true) throw new HttpError(400, "Reset requires { \"confirm\": true }");
    return c.json(await workflow.resetDemo());
  });

  return app;
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
