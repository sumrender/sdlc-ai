import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { AnswerQuestionInputSchema, CreateTaskInputSchema, DecideApprovalInputSchema } from "@sdlc-ai/shared";
import { db } from "../db/index.js";
import { artifacts } from "../db/schema.js";
import type { WorkflowService } from "../pipeline/workflow.js";
import { requireTask } from "../pipeline/tasks.js";
import { parseBody } from "./app.js";

export function taskRoutes(workflow: WorkflowService) {
  const r = new Hono();

  r.get("/", async (c) => c.json(await workflow.listTasks()));

  r.post("/", async (c) => {
    const input = await parseBody(c.req.raw, CreateTaskInputSchema);
    return c.json(await workflow.createTask(input), 201);
  });

  r.get("/:id", async (c) => c.json(await workflow.taskDetail(c.req.param("id"))));

  r.post("/:id/start", async (c) => c.json(await workflow.start(c.req.param("id"))));
  r.post("/:id/retry", async (c) => c.json(await workflow.retry(c.req.param("id"))));
  r.post("/:id/send-back", async (c) => c.json(await workflow.sendBackToDevelopment(c.req.param("id"))));

  r.get("/:id/artifacts", async (c) => {
    const task = await requireTask(c.req.param("id"));
    const rows = await db
      .select({
        id: artifacts.id,
        taskId: artifacts.taskId,
        agentRunId: artifacts.agentRunId,
        testRunId: artifacts.testRunId,
        type: artifacts.type,
        name: artifacts.name,
        sizeBytes: artifacts.sizeBytes,
        createdAt: artifacts.createdAt,
      })
      .from(artifacts)
      .where(eq(artifacts.taskId, task.id))
      .orderBy(asc(artifacts.createdAt));
    return c.json(rows);
  });

  return r;
}

export function questionRoutes(workflow: WorkflowService) {
  const r = new Hono();
  r.post("/:id/answer", async (c) => {
    const input = await parseBody(c.req.raw, AnswerQuestionInputSchema);
    return c.json(await workflow.answerQuestion(c.req.param("id"), input.answer));
  });
  return r;
}

export function approvalRoutes(workflow: WorkflowService) {
  const r = new Hono();
  r.post("/:id/decide", async (c) => {
    const input = await parseBody(c.req.raw, DecideApprovalInputSchema);
    return c.json(await workflow.decideApproval(c.req.param("id"), input));
  });
  return r;
}
