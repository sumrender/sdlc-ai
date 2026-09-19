import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { AnswerQuestionInputSchema, CreateTaskInputSchema, DecideApprovalInputSchema } from "@sdlc-ai/shared";
import { CONTENT_TYPES, type ArtifactStore } from "../artifacts/store.js";
import { db } from "../db/index.js";
import { artifacts } from "../db/schema.js";
import { HttpError } from "../errors.js";
import type { WorkflowService } from "../pipeline/workflow.js";
import { requireTask } from "../pipeline/tasks.js";
import { parseBody } from "./app.js";

export function taskRoutes(workflow: WorkflowService, store: ArtifactStore) {
  const r = new Hono();

  r.get("/", async (c) => c.json(await workflow.listTasks()));

  // Board actions answer with a BoardTask; detail actions answer with the TaskDetail. Both match the shared schemas the web app parses.
  r.post("/", async (c) => {
    const input = await parseBody(c.req.raw, CreateTaskInputSchema);
    const task = await workflow.createTask(input);
    return c.json(await workflow.boardTask(task.id), 201);
  });

  r.get("/:id", async (c) => c.json(await workflow.taskDetail(c.req.param("id"))));

  r.post("/:id/start", async (c) => {
    await workflow.start(c.req.param("id"));
    return c.json(await workflow.boardTask(c.req.param("id")));
  });
  r.post("/:id/retry", async (c) => {
    await workflow.retry(c.req.param("id"));
    return c.json(await workflow.taskDetail(c.req.param("id")));
  });
  r.post("/:id/send-back", async (c) => {
    await workflow.sendBackToDevelopment(c.req.param("id"));
    return c.json(await workflow.taskDetail(c.req.param("id")));
  });

  r.post("/:id/questions/:questionId/answer", async (c) => {
    const input = await parseBody(c.req.raw, AnswerQuestionInputSchema);
    await workflow.answerQuestion(c.req.param("id"), c.req.param("questionId"), input.answer);
    return c.json(await workflow.boardTask(c.req.param("id")));
  });

  r.post("/:id/approvals/:approvalId/decide", async (c) => {
    const input = await parseBody(c.req.raw, DecideApprovalInputSchema);
    await workflow.decideApproval(c.req.param("id"), c.req.param("approvalId"), input);
    return c.json(await workflow.taskDetail(c.req.param("id")));
  });

  r.get("/:id/artifacts", async (c) => {
    const task = await requireTask(c.req.param("id"));
    const rows = await db
      .select(publicArtifactColumns)
      .from(artifacts)
      .where(eq(artifacts.taskId, task.id))
      .orderBy(asc(artifacts.createdAt));
    return c.json(rows);
  });

  r.get("/:id/artifacts/:artifactId/content", async (c) => {
    const [row] = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.id, c.req.param("artifactId")), eq(artifacts.taskId, c.req.param("id"))))
      .limit(1);
    if (!row) throw new HttpError(404, "Artifact not found");
    const file = store.resolvePath(row);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat) throw new HttpError(404, "Artifact file missing on disk");
    const ext = path.extname(file).toLowerCase();
    c.header("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
    c.header("Content-Length", String(stat.size));
    if (c.req.query("download") === "1") c.header("Content-Disposition", `attachment; filename="${path.basename(row.name)}"`);
    return c.body(Readable.toWeb(fs.createReadStream(file)) as ReadableStream);
  });

  return r;
}

const publicArtifactColumns = {
  id: artifacts.id,
  taskId: artifacts.taskId,
  agentRunId: artifacts.agentRunId,
  testRunId: artifacts.testRunId,
  type: artifacts.type,
  name: artifacts.name,
  sizeBytes: artifacts.sizeBytes,
  createdAt: artifacts.createdAt,
};
