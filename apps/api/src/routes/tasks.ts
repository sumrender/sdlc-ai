import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { AnswerQuestionInputSchema, CreateTaskInputSchema, DecideApprovalInputSchema, DecideReviewInputSchema, DeleteTaskInputSchema, SendReviewBackInputSchema, UpdateReviewInputSchema } from "@sdlc-ai/shared";
import { CONTENT_TYPES, type ArtifactStore } from "../artifacts/store.js";
import { db } from "../db/index.js";
import { artifacts, testRuns } from "../db/schema.js";
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
  r.post("/:id/retry-with-new-branch", async (c) => {
    await workflow.retryWithNewBranch(c.req.param("id"));
    return c.json(await workflow.taskDetail(c.req.param("id")));
  });
  r.post("/:id/send-back", async (c) => {
    await workflow.sendBackToDevelopment(c.req.param("id"));
    return c.json(await workflow.taskDetail(c.req.param("id")));
  });

  // Operator stop: cancels live runs, frees Sandboxes, parks the Task FAILED.
  r.post("/:id/stop", async (c) => {
    await workflow.stop(c.req.param("id"));
    return c.json(await workflow.taskDetail(c.req.param("id")));
  });

  // Operator delete: stops first (delete implies stop), optionally closes the
  // GitHub issue/PR, then removes the Task and everything hanging off it.
  r.delete("/:id", async (c) => {
    const input = await parseBody(c.req.raw, DeleteTaskInputSchema);
    const result = await workflow.deleteTask(c.req.param("id"), input);
    return c.json(result);
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

  r.post("/:id/reviews/:reviewId/decision", async (c) => {
    const input = await parseBody(c.req.raw, DecideReviewInputSchema);
    await workflow.decideReview(c.req.param("id"), c.req.param("reviewId"), input);
    return c.json(await workflow.taskDetail(c.req.param("id")));
  });

  r.patch("/:id/reviews/:reviewId", async (c) => {
    const input = await parseBody(c.req.raw, UpdateReviewInputSchema);
    await workflow.updateReview(c.req.param("id"), c.req.param("reviewId"), input);
    return c.json(await workflow.taskDetail(c.req.param("id")));
  });

  r.post("/:id/reviews/:reviewId/send-back", async (c) => {
    const input = await parseBody(c.req.raw, SendReviewBackInputSchema);
    await workflow.sendReviewBackToDeveloper(c.req.param("id"), c.req.param("reviewId"), input);
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

  /**
   * Serves the Playwright HTML report as a directory tree rather than a single
   * Artifact blob. The report links its attachments relatively (`data/x.webm`),
   * so framing it at the opaque `/artifacts/:artifactId/content` URL makes every
   * video 404. Mounting it path-for-path under `/report/` means a relative link
   * from `/report/index.html` resolves to `/report/data/x.webm` and hits us here.
   *
   * The trailing `:filePath{.+}` is Hono's wildcard-with-slashes: it captures the
   * whole remainder of the path, already percent-decoded.
   */
  r.get("/:id/test-runs/:testRunId/report/:filePath{.+}", async (c) => {
    const task = await requireTask(c.req.param("id"));
    // Scope the lookup by taskId too: a Test Run id alone must not let one Task read another's report.
    const [run] = await db
      .select({ id: testRuns.id })
      .from(testRuns)
      .where(and(eq(testRuns.id, c.req.param("testRunId")), eq(testRuns.taskId, task.id)))
      .limit(1);
    if (!run) throw new HttpError(404, "Test Run not found");
    // The captured segment is untrusted; resolveWithin throws 403 if it escapes the report directory.
    const file = store.resolveWithin(store.reportDirPath(task.id, run.id), c.req.param("filePath"));
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat || !stat.isFile()) throw new HttpError(404, "Report file not found");
    const ext = path.extname(file).toLowerCase();
    c.header("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
    c.header("Content-Length", String(stat.size));
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
