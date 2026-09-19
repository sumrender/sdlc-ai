// Fills the database with one Project and Tasks in every Stage and Status so the web app
// can be built against realistic data. Wipes existing Tasks and Artifacts first.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { eq } from "drizzle-orm";
import { REVIEWERS, type Agent, type EventType, type Finding, type RunStatus, type Stage, type TaskStatus, type Verdict } from "@sdlc-ai/shared";
import { ArtifactStore } from "./artifacts/store.js";
import { closeDb, db, runMigrations } from "./db/index.js";
import { agentRuns, approvals, deployments, events, projects, questions, reviews, tasks, testRuns, type TaskRow } from "./db/schema.js";
import { env } from "./env.js";

const store = new ArtifactStore(env.ARTIFACTS_DIR);
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const sha = () => randomUUID().replace(/-/g, "") + "abcd1234";

const PLAN = `1. In fe/src/components/GalleryHeader.tsx render "{templates.length} templates" next to the title.
2. Guard against templates being undefined while the gallery query is loading.
3. Add an E2E assertion in fe/e2e/gallery.spec.ts for data-testid="template-count".
4. Run npm run build --prefix fe and npm run test:e2e.`;

const FINDINGS: Record<(typeof REVIEWERS)[number], { verdict: Verdict; findings: Finding[] }> = {
  REVIEWER_SECURITY: {
    verdict: "REJECT",
    findings: [{ severity: "HIGH", message: "templates.length is rendered without a null guard; a failed fetch renders a crash", file: "fe/src/components/GalleryHeader.tsx", line: 6 }],
  },
  REVIEWER_ARCHITECTURE: { verdict: "PASS", findings: [{ severity: "INFO", message: "Count derived in the component; fine at this size", file: "fe/src/components/GalleryHeader.tsx" }] },
  REVIEWER_QUALITY: { verdict: "PASS", findings: [{ severity: "LOW", message: "Consider extracting the count label for i18n", file: "fe/src/components/GalleryHeader.tsx", line: 6 }] },
  REVIEWER_PERFORMANCE: { verdict: "PASS", findings: [] },
};

async function main() {
  await runMigrations();
  const projectId = await upsertProject();
  await db.delete(tasks);
  await store.clear();

  let issue = 40;
  let pr = 120;

  const create = async (input: {
    title: string;
    description: string;
    stage: Stage;
    status: TaskStatus;
    ageMinutes: number;
    // Must precede everything the current Stage's Gate looks at, or advance() will redo the work on boot.
    stageEnteredMinutesAgo: number;
    plan?: string;
    withPr?: boolean;
    merged?: boolean;
    e2eRejectLoopUsed?: boolean;
    pendingFeedback?: string;
    error?: string;
  }): Promise<TaskRow> => {
    const id = randomUUID();
    const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    const n = ++issue;
    const p = input.withPr ? ++pr : null;
    const [row] = await db
      .insert(tasks)
      .values({
        id,
        projectId,
        title: input.title,
        description: input.description,
        stage: input.stage,
        status: input.status,
        plan: input.plan ?? null,
        issueNumber: n,
        issueUrl: `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${n}`,
        branchName: `sdlc/${id.slice(0, 8)}-${slug}`,
        pullRequestNumber: p,
        pullRequestUrl: p ? `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/pull/${p}` : null,
        mergedCommitSha: input.merged ? sha() : null,
        e2eRejectLoopUsed: input.e2eRejectLoopUsed ?? false,
        pendingFeedback: input.pendingFeedback ?? null,
        error: input.error ?? null,
        stageEnteredAt: minutesAgo(input.stageEnteredMinutesAgo),
        createdAt: minutesAgo(input.ageMinutes),
        updatedAt: minutesAgo(1),
      })
      .returning();
    await event(row!, "TASK_CREATED", { task: { ...row!, activeAgent: null, pendingQuestion: null, pendingApprovalId: null } }, input.ageMinutes);
    return row!;
  };

  const event = async (task: TaskRow, type: EventType, payload: Record<string, unknown>, agoMinutes: number) => {
    await db.insert(events).values({ taskId: task.id, type, payload, createdAt: minutesAgo(agoMinutes) });
  };

  const stageChange = async (task: TaskRow, from: Stage, to: Stage, agoMinutes: number) => {
    await event(task, "TASK_STAGE_CHANGED", { from, to, status: "RUNNING" }, agoMinutes);
  };

  const run = async (task: TaskRow, agent: Agent, status: RunStatus, agoMinutes: number, durationMinutes: number, lines: string[]) => {
    const model = agent === "DEVELOPER" ? env.MODEL_DEVELOPER : env.MODEL_FAST;
    const done = status !== "RUNNING" && status !== "QUEUED";
    const [row] = await db
      .insert(agentRuns)
      .values({
        taskId: task.id,
        agent,
        status,
        model,
        opencodeSessionId: `ses_seed_${agent.toLowerCase()}`,
        startedAt: minutesAgo(agoMinutes),
        completedAt: done ? minutesAgo(Math.max(0, agoMinutes - durationMinutes)) : null,
        exitCode: done ? (status === "COMPLETED" ? 0 : 1) : null,
        error: status === "FAILED" ? lines[lines.length - 1] : null,
        createdAt: minutesAgo(agoMinutes),
      })
      .returning();
    await event(task, "AGENT_RUN_STARTED", { agentRunId: row!.id, agent, attempt: 1, model }, agoMinutes);
    if (done) {
      await event(task, status === "COMPLETED" ? "AGENT_RUN_COMPLETED" : "AGENT_RUN_FAILED", { agentRunId: row!.id, agent, status }, agoMinutes - durationMinutes);
    }
    await store.saveLog({
      taskId: task.id,
      agentRunId: row!.id,
      name: `${agent.toLowerCase()}-attempt-1.log`,
      content: lines.map((l, i) => `${new Date(minutesAgo(agoMinutes).getTime() + i * 4000).toISOString()} ${l}`).join("\n"),
    });
    return row!;
  };

  const testRun = async (task: TaskRow, pass: boolean, agoMinutes: number) => {
    const output = pass ? "Running 12 tests using 2 workers\n\n  12 passed (48.2s)" : "Running 12 tests using 2 workers\n\n  1) gallery.spec.ts:14 › shows template count\n     Expected: \"12 templates\" Received: \"undefined templates\"\n\n  2 failed\n  10 passed (51.0s)";
    const [row] = await db
      .insert(testRuns)
      .values({
        taskId: task.id,
        command: "npm run test:e2e",
        status: "COMPLETED",
        exitCode: pass ? 0 : 1,
        passed: pass ? 12 : 10,
        failed: pass ? 0 : 2,
        skipped: 0,
        durationMs: pass ? 48_200 : 51_000,
        output,
        startedAt: minutesAgo(agoMinutes),
        completedAt: minutesAgo(agoMinutes - 1),
        createdAt: minutesAgo(agoMinutes),
      })
      .returning();
    await event(task, "TEST_RUN_STARTED", { testRunId: row!.id, attempt: 1 }, agoMinutes);
    await event(task, "TEST_RUN_COMPLETED", { testRunId: row!.id, status: "COMPLETED", exitCode: row!.exitCode, passed: row!.passed, failed: row!.failed }, agoMinutes - 1);
    await store.saveLog({ taskId: task.id, testRunId: row!.id, name: "e2e-attempt-1.log", content: `$ npm run test:e2e\n${output}` });
    await playwrightArtifacts(task.id, row!.id, pass);
    return row!;
  };

  // What a Test Run copies out of the Sandbox: the Playwright HTML report and a screenshot per test.
  const playwrightArtifacts = async (taskId: string, testRunId: string, pass: boolean) => {
    const dest = await store.testRunDir(taskId, testRunId);
    const report = path.join(dest, "playwright-report");
    await fs.mkdir(report, { recursive: true });
    await fs.writeFile(path.join(report, "index.html"), playwrightReportHtml(pass), "utf8");
    await store.importDir({ taskId, testRunId, dir: report, prefix: "fe/playwright-report" });
    const results = path.join(dest, "test-results", "gallery-shows-template-count");
    await fs.mkdir(results, { recursive: true });
    await fs.writeFile(path.join(results, pass ? "gallery-header.png" : "gallery-header-failed.png"), fakeScreenshotPng(pass));
    // Stub video so the task detail video path is demonstrable (ArtifactViewer plays VIDEO).
    await fs.writeFile(path.join(results, "gallery-shows-template-count-video.mp4"), "fake-mp4-bytes");
    await store.importDir({ taskId, testRunId, dir: path.join(dest, "test-results"), prefix: "fe/test-results" });
  };

  const review = async (task: TaskRow, reviewer: (typeof REVIEWERS)[number], agoMinutes: number) => {
    const r = await run(task, reviewer, "COMPLETED", agoMinutes, 2, [`Starting ${reviewer}`, "Cloning at task branch", "[tool] read fe/src/components/GalleryHeader.tsx", `Verdict: ${FINDINGS[reviewer].verdict}`]);
    const [row] = await db
      .insert(reviews)
      .values({ taskId: task.id, agentRunId: r.id, reviewer, verdict: FINDINGS[reviewer].verdict, findings: FINDINGS[reviewer].findings, createdAt: minutesAgo(agoMinutes - 2) })
      .returning();
    await event(task, "REVIEW_COMPLETED", { reviewId: row!.id, reviewer, verdict: row!.verdict, findingCount: row!.findings.length }, agoMinutes - 2);
  };

  const plannerLines = ["Starting PLANNER (attempt 1)", "Cloning at main", "$ npm ci", "[tool] read fe/src/components/GalleryHeader.tsx", "Plan stored"];
  const developerLines = ["Starting DEVELOPER (attempt 1)", "Cloning at main", "[tool] edit fe/src/components/GalleryHeader.tsx", "[tool] edit fe/e2e/gallery.spec.ts", "$ npm run build --prefix fe", "Committing and pushing as sdlc-ai[bot]", "Opened PR"];

  // TODO / READY
  await create({ title: "Add a dark-mode toggle to the settings drawer", description: "Persist the choice in localStorage and respect prefers-color-scheme on first load.", stage: "TODO", status: "READY", ageMinutes: 5, stageEnteredMinutesAgo: 5 });

  // PLANNING / WAITING on a Question
  {
    const t = await create({ title: "Let users favourite templates", description: "A heart icon on each card; favourites float to the top of the gallery.", stage: "PLANNING", status: "WAITING", ageMinutes: 12, stageEnteredMinutesAgo: 11 });
    await stageChange(t, "TODO", "PLANNING", 11);
    const r = await run(t, "PLANNER", "COMPLETED", 10, 2, ["Starting PLANNER (attempt 1)", "Cloning at main", "[tool] read fe/src/App.tsx", "Question for operator: Should favourites sync to the account or stay local?"]);
    const [q] = await db
      .insert(questions)
      .values({ taskId: t.id, agentRunId: r.id, text: "Should favourites sync to the user's account or stay local to the browser?", options: ["Account (needs a backend endpoint)", "Local only (localStorage)"], createdAt: minutesAgo(8) })
      .returning();
    await event(t, "QUESTION_CREATED", { question: q! }, 8);
    await event(t, "TASK_STATUS_CHANGED", { status: "WAITING", from: "RUNNING", to: "WAITING", stage: "PLANNING" }, 8);
  }

  // DEVELOPMENT / RUNNING
  {
    const t = await create({ title: "Show the template count in the gallery header", description: "Display the total number of templates in the gallery header.", stage: "DEVELOPMENT", status: "RUNNING", ageMinutes: 25, stageEnteredMinutesAgo: 20, plan: PLAN });
    await stageChange(t, "TODO", "PLANNING", 24);
    await run(t, "PLANNER", "COMPLETED", 23, 3, plannerLines);
    await stageChange(t, "PLANNING", "DEVELOPMENT", 20);
    await run(t, "DEVELOPER", "RUNNING", 19, 0, developerLines.slice(0, 4));
    await event(t, "CHECKS_STARTED", { commands: ["npm run build --prefix fe"] }, 2);
  }

  // E2E / FAILED after the automatic Reject loop
  {
    const t = await create({ title: "Sort templates by most recently used", description: "Order the gallery by lastUsedAt descending, falling back to name.", stage: "E2E", status: "FAILED", ageMinutes: 80, stageEnteredMinutesAgo: 46, plan: PLAN, withPr: true, e2eRejectLoopUsed: true, error: "E2E failed again after the automatic Reject loop (2 failed)" });
    await stageChange(t, "TODO", "PLANNING", 79);
    await run(t, "PLANNER", "COMPLETED", 78, 3, plannerLines);
    await stageChange(t, "PLANNING", "DEVELOPMENT", 75);
    await run(t, "DEVELOPER", "COMPLETED", 74, 12, developerLines);
    await event(t, "PR_CREATED", { number: t.pullRequestNumber, url: t.pullRequestUrl, branch: t.branchName }, 62);
    await stageChange(t, "DEVELOPMENT", "E2E", 61);
    await testRun(t, false, 60);
    await stageChange(t, "E2E", "DEVELOPMENT", 58);
    await run(t, "DEVELOPER", "COMPLETED", 57, 10, developerLines);
    await stageChange(t, "DEVELOPMENT", "E2E", 46);
    await testRun(t, false, 45);
    await event(t, "TASK_STATUS_CHANGED", { status: "FAILED", from: "RUNNING", to: "FAILED", stage: "E2E" }, 44);
    await event(t, "TASK_FAILED", { stage: "E2E", error: t.error }, 44);
  }

  // AGENT_REVIEW / RUNNING (two Reviews in, two Reviewers still running)
  {
    const t = await create({ title: "Add keyboard navigation to the gallery grid", description: "Arrow keys move focus between cards; Enter opens the template.", stage: "AGENT_REVIEW", status: "RUNNING", ageMinutes: 40, stageEnteredMinutesAgo: 6, plan: PLAN, withPr: true });
    await stageChange(t, "TODO", "PLANNING", 39);
    await run(t, "PLANNER", "COMPLETED", 38, 3, plannerLines);
    await stageChange(t, "PLANNING", "DEVELOPMENT", 35);
    await run(t, "DEVELOPER", "COMPLETED", 34, 14, developerLines);
    await event(t, "PR_CREATED", { number: t.pullRequestNumber, url: t.pullRequestUrl, branch: t.branchName }, 20);
    await stageChange(t, "DEVELOPMENT", "E2E", 19);
    await testRun(t, true, 18);
    await stageChange(t, "E2E", "AGENT_REVIEW", 6);
    await review(t, "REVIEWER_ARCHITECTURE", 5);
    await review(t, "REVIEWER_QUALITY", 5);
    await run(t, "REVIEWER_SECURITY", "RUNNING", 5, 0, ["Starting REVIEWER_SECURITY", "Cloning at task branch", "[tool] read fe/src/components/GalleryGrid.tsx"]);
    await run(t, "REVIEWER_PERFORMANCE", "RUNNING", 5, 0, ["Starting REVIEWER_PERFORMANCE", "Cloning at task branch"]);
  }

  // HUMAN_REVIEW / WAITING on an Approval
  {
    const t = await create({ title: "Show template count in the gallery header (rehearsal)", description: "Second rehearsal of the demo task.", stage: "HUMAN_REVIEW", status: "WAITING", ageMinutes: 55, stageEnteredMinutesAgo: 15, plan: PLAN, withPr: true });
    await stageChange(t, "TODO", "PLANNING", 54);
    await run(t, "PLANNER", "COMPLETED", 53, 3, plannerLines);
    await stageChange(t, "PLANNING", "DEVELOPMENT", 50);
    await run(t, "DEVELOPER", "COMPLETED", 49, 15, developerLines);
    await event(t, "PR_CREATED", { number: t.pullRequestNumber, url: t.pullRequestUrl, branch: t.branchName }, 34);
    await stageChange(t, "DEVELOPMENT", "E2E", 33);
    await testRun(t, true, 32);
    await stageChange(t, "E2E", "AGENT_REVIEW", 20);
    for (const reviewer of REVIEWERS) await review(t, reviewer, 19);
    await stageChange(t, "AGENT_REVIEW", "HUMAN_REVIEW", 15);
    const [a] = await db.insert(approvals).values({ taskId: t.id, createdAt: minutesAgo(15) }).returning();
    await event(t, "APPROVAL_REQUESTED", { approvalId: a!.id }, 15);
    await event(t, "TASK_STATUS_CHANGED", { status: "WAITING", from: "RUNNING", to: "WAITING", stage: "HUMAN_REVIEW" }, 15);
  }

  // STAGING / RUNNING (FE live, BE building)
  {
    const t = await create({ title: "Return template counts from the API", description: "Add GET /templates/count so the header does not load every template.", stage: "STAGING", status: "RUNNING", ageMinutes: 70, stageEnteredMinutesAgo: 5, plan: PLAN, withPr: true, merged: true });
    await stageChange(t, "TODO", "PLANNING", 69);
    await run(t, "PLANNER", "COMPLETED", 68, 3, plannerLines);
    await stageChange(t, "PLANNING", "DEVELOPMENT", 65);
    await run(t, "DEVELOPER", "COMPLETED", 64, 16, developerLines);
    await event(t, "PR_CREATED", { number: t.pullRequestNumber, url: t.pullRequestUrl, branch: t.branchName }, 48);
    await stageChange(t, "DEVELOPMENT", "E2E", 47);
    await testRun(t, true, 46);
    await stageChange(t, "E2E", "AGENT_REVIEW", 34);
    for (const reviewer of REVIEWERS) await review(t, reviewer, 33);
    await stageChange(t, "AGENT_REVIEW", "HUMAN_REVIEW", 29);
    const [a] = await db.insert(approvals).values({ taskId: t.id, status: "APPROVED", createdAt: minutesAgo(29), decidedAt: minutesAgo(6) }).returning();
    await event(t, "APPROVAL_REQUESTED", { approvalId: a!.id }, 29);
    await event(t, "APPROVAL_DECIDED", { approvalId: a!.id, decision: "APPROVED", feedback: null }, 6);
    await event(t, "MERGED", { sha: t.mergedCommitSha, pullRequestNumber: t.pullRequestNumber, changedFiles: ["fe/src/components/GalleryHeader.tsx", "be/Controllers/TemplatesController.cs"] }, 5);
    await stageChange(t, "HUMAN_REVIEW", "STAGING", 5);
    const [fe] = await db.insert(deployments).values({ taskId: t.id, target: "FE", provider: "CLOUDFLARE", commitSha: t.mergedCommitSha!, status: "LIVE", url: env.FE_ORIGIN ?? "https://meme-fe.stage.example", providerRef: "cf-build-9f31", lastPolledAt: minutesAgo(1), createdAt: minutesAgo(5) }).returning();
    const [be] = await db.insert(deployments).values({ taskId: t.id, target: "BE", provider: "RENDER", commitSha: t.mergedCommitSha!, status: "BUILDING", url: env.BE_ORIGIN ?? "https://meme-be.stage.example", providerRef: "dep-c8a2", lastPolledAt: minutesAgo(0), createdAt: minutesAgo(5) }).returning();
    await event(t, "DEPLOYMENT_UPDATED", { deploymentId: fe!.id, target: "FE", provider: "CLOUDFLARE", from: "PENDING", to: "LIVE", url: fe!.url }, 2);
    await event(t, "DEPLOYMENT_UPDATED", { deploymentId: be!.id, target: "BE", provider: "RENDER", from: "PENDING", to: "BUILDING", url: be!.url }, 3);
  }

  // STAGING / COMPLETED
  {
    const t = await create({ title: "Fix gallery card image aspect ratio", description: "Cards should keep a 4:3 ratio regardless of the source image.", stage: "STAGING", status: "COMPLETED", ageMinutes: 180, stageEnteredMinutesAgo: 129, plan: PLAN, withPr: true, merged: true });
    await stageChange(t, "TODO", "PLANNING", 179);
    await run(t, "PLANNER", "COMPLETED", 178, 2, plannerLines);
    await stageChange(t, "PLANNING", "DEVELOPMENT", 176);
    await run(t, "DEVELOPER", "COMPLETED", 175, 11, developerLines);
    await event(t, "PR_CREATED", { number: t.pullRequestNumber, url: t.pullRequestUrl, branch: t.branchName }, 164);
    await stageChange(t, "DEVELOPMENT", "E2E", 163);
    await testRun(t, true, 162);
    await stageChange(t, "E2E", "AGENT_REVIEW", 150);
    for (const reviewer of REVIEWERS) await review(t, reviewer, 149);
    await stageChange(t, "AGENT_REVIEW", "HUMAN_REVIEW", 145);
    const [a] = await db.insert(approvals).values({ taskId: t.id, status: "APPROVED", createdAt: minutesAgo(145), decidedAt: minutesAgo(130) }).returning();
    await event(t, "APPROVAL_REQUESTED", { approvalId: a!.id }, 145);
    await event(t, "APPROVAL_DECIDED", { approvalId: a!.id, decision: "APPROVED", feedback: null }, 130);
    await event(t, "MERGED", { sha: t.mergedCommitSha, pullRequestNumber: t.pullRequestNumber, changedFiles: ["fe/src/components/TemplateCard.tsx"] }, 129);
    await stageChange(t, "HUMAN_REVIEW", "STAGING", 129);
    const [fe] = await db.insert(deployments).values({ taskId: t.id, target: "FE", provider: "CLOUDFLARE", commitSha: t.mergedCommitSha!, status: "LIVE", url: env.FE_ORIGIN ?? "https://meme-fe.stage.example", providerRef: "cf-build-8e02", lastPolledAt: minutesAgo(125), createdAt: minutesAgo(129) }).returning();
    await event(t, "DEPLOYMENT_UPDATED", { deploymentId: fe!.id, target: "FE", provider: "CLOUDFLARE", from: "BUILDING", to: "LIVE", url: fe!.url }, 125);
    await event(t, "TASK_STATUS_CHANGED", { status: "COMPLETED", from: "RUNNING", to: "COMPLETED", stage: "STAGING" }, 125);
  }

  const count = await db.select({ id: tasks.id }).from(tasks);
  console.log(`[seed] ${count.length} tasks seeded for ${env.GITHUB_OWNER}/${env.GITHUB_REPO}; artifacts under ${store.root}`);
}

function playwrightReportHtml(pass: boolean): string {
  const rows = [
    ["gallery.spec.ts", "shows template count", pass ? "passed" : "failed", "4.1s"],
    ["gallery.spec.ts", "opens a template", "passed", "3.2s"],
    ["gallery.spec.ts", "filters by tag", "passed", "2.8s"],
    ["editor.spec.ts", "renders caption preview", "passed", "5.0s"],
    ["editor.spec.ts", "exports a PNG", pass ? "passed" : "failed", "6.4s"],
  ];
  const tr = rows
    .map(([file, name, status, ms]) => `<tr class="${status}"><td>${file}</td><td>${name}</td><td>${status}</td><td>${ms}</td></tr>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Playwright Test Report</title>
<style>body{font:14px system-ui;margin:24px;color:#111}h1{font-size:18px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left}
.passed td:nth-child(3){color:#15803d}.failed td:nth-child(3){color:#b91c1c;font-weight:600}.summary{margin:12px 0 20px;color:#444}</style></head>
<body><h1>Playwright Test Report</h1><p class="summary">${pass ? "12 passed" : "10 passed, 2 failed"} · ${pass ? "48.2s" : "51.0s"} · chromium</p>
<table><thead><tr><th>File</th><th>Test</th><th>Status</th><th>Duration</th></tr></thead><tbody>${tr}</tbody></table>
<p class="summary">Seeded report: stands in for the real report copied out of the Sandbox.</p></body></html>`;
}

// A valid 320x200 PNG (a two-tone gradient with a status stripe) so screenshots render in the ArtifactViewer.
function fakeScreenshotPng(pass: boolean): Buffer {
  const width = 320;
  const height = 200;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const i = y * (width * 3 + 1) + 1 + x * 3;
      const stripe = y < 28;
      raw[i] = stripe ? (pass ? 22 : 185) : 24 + Math.floor((x / width) * 40);
      raw[i + 1] = stripe ? (pass ? 163 : 28) : 24 + Math.floor((y / height) * 40);
      raw[i + 2] = stripe ? (pass ? 74 : 28) : 40 + Math.floor((x / width) * 60);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf: Buffer): number {
  let crc = -1;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ -1) >>> 0;
}

async function upsertProject(): Promise<string> {
  const values = {
    name: env.GITHUB_REPO,
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    defaultBranch: env.GITHUB_DEFAULT_BRANCH,
    deployTargets: [
      { target: "FE" as const, provider: "CLOUDFLARE" as const, pathPrefix: "fe/", url: env.FE_ORIGIN ?? null },
      { target: "BE" as const, provider: "RENDER" as const, pathPrefix: "be/", url: env.BE_ORIGIN ?? null },
    ],
  };
  const [existing] = await db.select().from(projects).limit(1);
  if (existing) {
    await db.update(projects).set(values).where(eq(projects.id, existing.id));
    return existing.id;
  }
  const [row] = await db.insert(projects).values(values).returning();
  return row!.id;
}

main()
  .then(() => closeDb())
  .catch(async (e) => {
    console.error("[seed] failed:", e);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
