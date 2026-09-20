import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskRow, TestRunRow } from "../db/schema.js";

// See e2e-coverage.test.ts: the module graph reaches db/index.js, whose
// postgres client is lazy, so a well-formed URL is enough to import it.
process.env.DATABASE_URL ??= "postgres://sdlc:sdlc@127.0.0.1:5432/sdlc_test";
const { buildE2EComment, E2E_MARKER } = await import("./e2e-report.js");

const TASK_URL = "http://localhost:3000/tasks/c3714ed6-0000-0000-0000-000000000000";
const now = new Date("2026-01-01T00:00:00.000Z");

const task: TaskRow = {
  id: "c3714ed6-0000-0000-0000-000000000000",
  projectId: "00000000-0000-0000-0000-000000000001",
  title: "Add public API docs page",
  description: "",
  stage: "E2E",
  status: "RUNNING",
  plan: null,
  issueNumber: null,
  issueUrl: null,
  branchName: "sdlc/api-docs",
  pullRequestNumber: 58,
  pullRequestUrl: null,
  mergedCommitSha: null,
  e2eRejectLoopUsed: false,
  e2eCoverageCheckedAt: null,
  e2eGeneratedSpecPath: null,
  e2eReportCommentUrl: null,
  e2eReportVideoUrl: null,
  pendingFeedback: null,
  error: null,
  stageEnteredAt: now,
  createdAt: now,
  updatedAt: now,
};

const run: TestRunRow = {
  id: "9f0f0f0f-0000-0000-0000-000000000000",
  taskId: task.id,
  command: "npm run test:e2e",
  status: "COMPLETED",
  attempt: 1,
  exitCode: 0,
  passed: 33,
  failed: 0,
  skipped: null,
  durationMs: 42_000,
  output: null,
  error: null,
  coverageChecked: true,
  generatedSpecPath: null,
  startedAt: now,
  completedAt: now,
  createdAt: now,
};

describe("buildE2EComment", () => {
  it("links the control plane once there is at least one video", () => {
    const body = buildE2EComment({ task, run, generatedSpecPath: null, taskUrl: TASK_URL, videoCount: 4 });
    assert.ok(body.startsWith(E2E_MARKER));
    assert.match(body, /🎬 4 test videos — \[watch in the control plane\]/);
    assert.ok(body.includes(`(${TASK_URL})`));
    // Videos are control-plane artifacts now; nothing is hosted on GitHub.
    assert.doesNotMatch(body, /releases\/download/);
  });

  it("uses the singular noun for a single video", () => {
    const body = buildE2EComment({ task, run, generatedSpecPath: null, taskUrl: TASK_URL, videoCount: 1 });
    assert.match(body, /🎬 1 test video — \[watch in the control plane\]/);
  });

  it("omits the video line entirely at zero", () => {
    const body = buildE2EComment({ task, run, generatedSpecPath: null, taskUrl: TASK_URL, videoCount: 0 });
    assert.doesNotMatch(body, /🎬/);
    assert.match(body, /✅ E2E passed — 33 passed, 0 failed/);
  });

  it("reports a failed run and still lists the generated spec", () => {
    const failed: TestRunRow = { ...run, exitCode: 1, passed: 32, failed: 1 };
    const body = buildE2EComment({ task, run: failed, generatedSpecPath: "fe/e2e/api-docs.spec.ts", taskUrl: TASK_URL, videoCount: 2 });
    assert.match(body, /❌ E2E failed — 32 passed, 1 failed/);
    assert.match(body, /New test added by E2E: `fe\/e2e\/api-docs\.spec\.ts`/);
    assert.match(body, /🎬 2 test videos/);
  });
});
