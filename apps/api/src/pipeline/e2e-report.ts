import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { artifacts, tasks, type TaskRow, type TestRunRow } from "../db/schema.js";
import { env } from "../env.js";
import { bus } from "../events/bus.js";
import type { Deps } from "./deps.js";

export const E2E_MARKER = "<!-- sdlc-ai-e2e -->";
const BODY_SECTION_START = "<!-- sdlc-ai-e2e-start -->";
const BODY_SECTION_END = "<!-- sdlc-ai-e2e-end -->";

export interface E2EReportInput {
  task: TaskRow;
  run: TestRunRow;
  generatedSpecPath: string | null;
}

export function buildE2EComment(input: E2EReportInput & { taskUrl: string; videoUrl: string | null }): string {
  const { task, run, generatedSpecPath, taskUrl, videoUrl } = input;
  const passed = run.status === "COMPLETED" && run.exitCode === 0;
  const headline = passed ? "✅ E2E passed" : "❌ E2E failed";
  const counts = run.passed != null ? `${run.passed} passed, ${run.failed ?? 0} failed${run.skipped ? `, ${run.skipped} skipped` : ""}` : "n/a";
  const specLine = generatedSpecPath ? `\n- New test added by E2E: \`${generatedSpecPath}\`` : "";
  const videoLine = videoUrl ? `\n- 🎬 [Watch the test video](${videoUrl})` : "";
  return `${E2E_MARKER}\n### ${headline} — ${counts}\n\n- Task: ${task.title}\n- Control plane: ${taskUrl}${specLine}${videoLine}\n\n_Test Run ${run.id.slice(0, 8)} · attempt ${run.attempt} · exit ${run.exitCode ?? "n/a"}_`;
}

function taskUrl(taskId: string): string {
  return `${env.CONTROL_PLANE_URL}/tasks/${taskId}`;
}

// Uploads the first VIDEO artifact of the run to GitHub; null when there is
// none or the upload fails (caller falls back to no video link + a warning).
async function githubVideoUrl(deps: Deps, taskId: string, testRunId: string, log: (l: string) => void): Promise<string | null> {
  const rows = await db.select().from(artifacts).where(eq(artifacts.testRunId, testRunId));
  const video = rows.find((r) => r.type === "VIDEO");
  if (!video) return null;
  try {
    const abs = deps.artifacts.resolvePath(video);
    const { readFile } = await import("node:fs/promises");
    const data = await readFile(abs);
    const ext = video.name.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4";
    const base = video.name.split("/").pop() ?? "e2e-video.mp4";
    const uploaded = await deps.github.uploadVideoAsset(`${taskId.slice(0, 8)}-${base}`, data, ext);
    return uploaded.url;
  } catch (e) {
    log(`Video upload to GitHub failed; PR will link no video: ${(e as Error).message}`);
    return null;
  }
}

// Posts/updates the marker comment and refreshes the PR body section after
// every Test Run (pass or fail). Records URLs on tasks + PR_COMMENT_POSTED.
export async function postE2EReport(deps: Deps, input: E2EReportInput, log: (l: string) => void = () => undefined): Promise<{ commentUrl: string; videoUrl: string | null }> {
  const { task, run, generatedSpecPath } = input;
  if (!task.pullRequestNumber) throw new Error("Cannot post E2E report: task has no PR");
  const url = taskUrl(task.id);
  const videoUrl = await githubVideoUrl(deps, task.id, run.id, log);
  const body = buildE2EComment({ task, run, generatedSpecPath, taskUrl: url, videoUrl });

  const comments = await deps.github.listComments(task.pullRequestNumber);
  const ours = comments.find((c) => c.body.includes(E2E_MARKER));
  let commentUrl: string;
  if (ours) {
    await deps.github.updateComment(ours.id, body);
    commentUrl = `updated comment ${ours.id}`;
    log(`Updated E2E PR comment ${ours.id}`);
  } else {
    const created = await deps.github.createComment(task.pullRequestNumber, body);
    commentUrl = created.url;
    log(`Posted E2E PR comment: ${created.url}`);
  }

  await refreshPrBody(deps, task.pullRequestNumber, run, generatedSpecPath, videoUrl, url, log);
  await db
    .update(tasks)
    .set({ e2eReportCommentUrl: commentUrl, e2eReportVideoUrl: videoUrl, updatedAt: new Date() })
    .where(eq(tasks.id, task.id));
  await bus.emit(task.id, "PR_COMMENT_POSTED", { url: commentUrl, videoUrl, testRunId: run.id });
  return { commentUrl, videoUrl };
}

async function refreshPrBody(
  deps: Deps,
  pullNumber: number,
  run: TestRunRow,
  generatedSpecPath: string | null,
  videoUrl: string | null,
  url: string,
  log: (l: string) => void,
): Promise<void> {
  const current = await deps.github.getPullRequestBody(pullNumber).catch(() => "");
  const section =
    `${BODY_SECTION_START}\n## Latest E2E\n` +
    `- ${run.status === "COMPLETED" && run.exitCode === 0 ? "✅ passed" : "❌ failed"}: ${run.passed != null ? `${run.passed} passed, ${run.failed ?? 0} failed` : "n/a"} (attempt ${run.attempt})\n` +
    (generatedSpecPath ? `- New test: \`${generatedSpecPath}\`\n` : "") +
    (videoUrl ? `- 🎬 [Watch the test video](${videoUrl})\n` : "") +
    `- [Open in control plane](${url})\n${BODY_SECTION_END}`;
  const next = current.includes(BODY_SECTION_START)
    ? current.replace(new RegExp(`${BODY_SECTION_START}[\\s\\S]*?${BODY_SECTION_END}`), section)
    : `${current}\n\n${section}`;
  // Read-modify-write: HUMAN_REVIEW merge happens later-stage, no conflict expected.
  await deps.github.updatePullRequestBody(pullNumber, next).catch((e) => log(`PR body refresh failed: ${(e as Error).message}`));
}
