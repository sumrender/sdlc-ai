import {
  DEMO_TASK,
  findBlockingTask,
  retryAvailability,
  sendBackAvailability,
  REVIEWERS,
  type Agent,
  type AgentRun,
  type AnswerQuestionInput,
  type Approval,
  type Artifact,
  type BoardTask,
  type CreateTaskInput,
  type DecideApprovalInput,
  type Deployment,
  type Event,
  type EventType,
  type Finding,
  type ProjectSettings,
  type Question,
  type ResetDemoResult,
  type Review,
  type Reviewer,
  type SseMessage,
  type Stage,
  type TaskDetail,
  type TaskStatus,
  type TestRun,
  type Verdict,
} from "@sdlc-ai/shared";
import { ApiRequestError, type ApiClient } from "./api";
import { applyEventToTasks } from "./board";
import type { EventSourceLike } from "./event-stream";

/**
 * An in-memory ApiClient plus a matching EventSource for running the web app
 * before the backend exists (issue #1: "Kanban with fake Events first").
 * Selected with VITE_API_MODE=fixture. Starting a Task walks it through every
 * Stage on a timer, pausing on the Planner's Question and stopping at the
 * Approval. Events are applied to the store with the same code the board uses;
 * each Task also keeps the runs, Artifacts, and Events the detail page reads,
 * and a running Agent emits AGENT_OUTPUT lines on a ticker.
 */
export interface FixtureApi {
  client: ApiClient;
  createEventSource: (url: string) => EventSourceLike;
}

const STEP_MS = 1600;
const OUTPUT_MS = 500;
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;
const EVENTS_URL = "fixture://events";

declare global {
  interface Window {
    /** Dev helper: simulates the SSE connection dropping so reconnect can be observed. */
    sdlcFixture?: { dropConnection(): void };
  }
}

interface DetailState {
  agentRuns: AgentRun[];
  testRuns: TestRun[];
  questions: Question[];
  reviews: Review[];
  approvals: Approval[];
  deployments: Deployment[];
  artifacts: Artifact[];
  events: Event[];
  /** Output lines per run id, flushed into a LOG Artifact when the run finishes. */
  output: Map<string, string[]>;
  logs: Map<string, string>;
}

const emptyDetail = (): DetailState => ({
  agentRuns: [],
  testRuns: [],
  questions: [],
  reviews: [],
  approvals: [],
  deployments: [],
  artifacts: [],
  events: [],
  output: new Map(),
  logs: new Map(),
});

const AGENT_SCRIPT: Record<Agent, string[]> = {
  PLANNER: ["Cloning at main", "$ npm ci", "[tool] read fe/src/App.tsx", "[tool] read fe/src/components/GalleryHeader.tsx", "Drafting the Plan", "Plan stored"],
  DEVELOPER: [
    "Cloning at main",
    "[tool] read fe/src/components/GalleryHeader.tsx",
    "[tool] edit fe/src/components/GalleryHeader.tsx",
    "[tool] edit fe/e2e/gallery.spec.ts",
    "$ npm run build --prefix fe",
    "Build passed in 14.2s",
    "Committing and pushing as sdlc-ai[bot]",
    "Opened PR",
  ],
  REVIEWER_SECURITY: ["Cloning at task branch", "[tool] read fe/src/components/GalleryHeader.tsx", "Checking for unsanitised rendering", "Verdict: REJECT"],
  REVIEWER_ARCHITECTURE: ["Cloning at task branch", "[tool] read fe/src/components/GalleryHeader.tsx", "Verdict: PASS"],
  REVIEWER_QUALITY: ["Cloning at task branch", "[tool] read fe/e2e/gallery.spec.ts", "Verdict: PASS"],
  REVIEWER_PERFORMANCE: ["Cloning at task branch", "Measuring gallery render", "Verdict: PASS"],
  E2E_TEST_WRITER: ["Cloning at task branch", "[tool] edit fe/e2e/generated-coverage.spec.ts", "Committing and pushing as sdlc-ai[bot]", "E2E spec ready"],
};

const REVIEW_OUTPUT: Record<Reviewer, { verdict: Verdict; findings: Finding[] }> = {
  REVIEWER_SECURITY: {
    verdict: "REJECT",
    findings: [
      { severity: "HIGH", message: "templates.length is rendered without a null guard; a failed fetch renders a crash", file: "fe/src/components/GalleryHeader.tsx", line: 6 },
      { severity: "MEDIUM", message: "Count text is interpolated into the heading without escaping; safe today, fragile if the label becomes user-supplied", file: "fe/src/components/GalleryHeader.tsx", line: 8 },
    ],
  },
  REVIEWER_ARCHITECTURE: { verdict: "PASS", findings: [{ severity: "INFO", message: "Count derived in the component; fine at this size", file: "fe/src/components/GalleryHeader.tsx" }] },
  REVIEWER_QUALITY: { verdict: "PASS", findings: [{ severity: "LOW", message: "Consider extracting the count label for i18n", file: "fe/src/components/GalleryHeader.tsx", line: 6 }] },
  REVIEWER_PERFORMANCE: { verdict: "PASS", findings: [] },
};

const FIXTURE_SETTINGS: ProjectSettings = {
  project: {
    id: "fixture-project",
    name: "meme",
    owner: "sumrender",
    repo: "meme",
    defaultBranch: "main",
    deployTargets: [
      { target: "FE", provider: "CLOUDFLARE", pathPrefix: "fe/", url: "https://meme-fe.stage.example" },
      { target: "BE", provider: "RENDER", pathPrefix: "be/", url: "https://meme-be.stage.example" },
    ],
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString(),
  },
  github: { ok: true, login: "sdlc-ai[bot]" },
  manifest: {
    ok: true,
    manifest: {
      setup: ["npm ci", "npm ci --prefix fe"],
      checks: ["npm run lint", "npm run build --prefix fe"],
      e2e: { command: "npm run test:e2e", cwd: "fe", env: { CI: "1", BASE_URL: "http://localhost:5173" }, artifacts: ["fe/playwright-report", "fe/test-results"] },
    },
  },
  deployProviders: { CLOUDFLARE: true, RENDER: false },
  models: { developer: "claude-sonnet-5", fast: "claude-haiku-4-5-20251001" },
  sandboxImage: "sdlc-ai-sandbox:local",
  fakes: true,
  activeTask: null,
};

const isReviewer = (agent: Agent): agent is Reviewer => (REVIEWERS as readonly Agent[]).includes(agent);

export function createFixtureApi(): FixtureApi {
  let tasks: BoardTask[] = [];
  const details = new Map<string, DetailState>();
  const sources = new Set<FixtureEventSource>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const tickers = new Map<string, ReturnType<typeof setInterval>>();

  const detailOf = (taskId: string): DetailState => {
    let state = details.get(taskId);
    if (!state) {
      state = emptyDetail();
      details.set(taskId, state);
    }
    return state;
  };

  const broadcast = (message: SseMessage) => {
    for (const source of sources) source.deliver(message);
  };

  const emit = (taskId: string, type: EventType, payload: Record<string, unknown>) => {
    const event: Event = { id: crypto.randomUUID(), taskId, type, payload, createdAt: now() };
    tasks = applyEventToTasks(tasks, event).tasks;
    detailOf(taskId).events.push(event);
    broadcast({ kind: "event", event });
  };

  const after = (ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };

  const find = (taskId: string): BoardTask => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new ApiRequestError(404, `Task ${taskId} not found`, "NOT_FOUND");
    return task;
  };

  const patchTask = (taskId: string, patch: Partial<BoardTask>) => {
    tasks = tasks.map((t) => (t.id === taskId ? { ...t, ...patch, updatedAt: now() } : t));
  };

  const output = (taskId: string, ref: { agentRunId?: string; testRunId?: string }, line: string) => {
    const at = now();
    const state = detailOf(taskId);
    const id = ref.agentRunId ?? ref.testRunId ?? "task";
    state.output.set(id, [...(state.output.get(id) ?? []), `${at} ${line}`]);
    broadcast({ kind: "agent_output", taskId, agentRunId: ref.agentRunId ?? null, testRunId: ref.testRunId ?? null, line, at });
  };

  const saveLog = (taskId: string, ref: { agentRunId?: string; testRunId?: string }, name: string) => {
    const state = detailOf(taskId);
    const id = ref.agentRunId ?? ref.testRunId ?? "task";
    const content = (state.output.get(id) ?? []).join("\n");
    const artifact: Artifact = {
      id: crypto.randomUUID(),
      taskId,
      agentRunId: ref.agentRunId ?? null,
      testRunId: ref.testRunId ?? null,
      type: "LOG",
      name,
      sizeBytes: content.length,
      createdAt: now(),
    };
    state.artifacts.push(artifact);
    state.logs.set(artifact.id, content);
  };

  const finishAgentRun = (taskId: string, runId: string, status: AgentRun["status"] = "COMPLETED") => {
    const state = detailOf(taskId);
    const run = state.agentRuns.find((r) => r.id === runId);
    if (!run || run.status !== "RUNNING") return;
    const ticker = tickers.get(runId);
    if (ticker) clearInterval(ticker);
    tickers.delete(runId);
    Object.assign(run, { status, completedAt: now(), exitCode: status === "COMPLETED" ? 0 : 1 });
    saveLog(taskId, { agentRunId: runId }, `${run.agent.toLowerCase()}-attempt-${run.attempt}.log`);
    emit(taskId, status === "COMPLETED" ? "AGENT_RUN_COMPLETED" : "AGENT_RUN_FAILED", { agentRunId: runId, agent: run.agent, attempt: run.attempt, status });
    if (status === "COMPLETED" && isReviewer(run.agent)) {
      const review: Review = { id: crypto.randomUUID(), taskId, agentRunId: runId, reviewer: run.agent, ...REVIEW_OUTPUT[run.agent], createdAt: now() };
      state.reviews.push(review);
      emit(taskId, "REVIEW_COMPLETED", { reviewId: review.id, reviewer: review.reviewer, verdict: review.verdict, findingCount: review.findings.length });
    }
  };

  const finishRunning = (taskId: string) => {
    for (const run of detailOf(taskId).agentRuns) if (run.status === "RUNNING") finishAgentRun(taskId, run.id);
  };

  const moveTo = (taskId: string, to: Stage, status: TaskStatus) => {
    finishRunning(taskId);
    emit(taskId, "TASK_STAGE_CHANGED", { from: find(taskId).stage, to, status });
  };

  const runAgent = (taskId: string, agent: Agent) => {
    const state = detailOf(taskId);
    const attempt = state.agentRuns.filter((r) => r.agent === agent).length + 1;
    const run: AgentRun = {
      id: crypto.randomUUID(),
      taskId,
      agent,
      status: "RUNNING",
      attempt,
      opencodeSessionId: `ses_fixture_${agent.toLowerCase()}`,
      model: agent === "DEVELOPER" ? "claude-sonnet-5" : "claude-haiku-4-5-20251001",
      startedAt: now(),
      completedAt: null,
      exitCode: null,
      error: null,
      createdAt: now(),
    };
    state.agentRuns.push(run);
    emit(taskId, "AGENT_RUN_STARTED", { agentRunId: run.id, agent, attempt, model: run.model });
    output(taskId, { agentRunId: run.id }, `Starting ${agent} (attempt ${attempt}, model ${run.model})`);
    const script = AGENT_SCRIPT[agent];
    let index = 0;
    const ticker = setInterval(() => {
      const line = script[index++];
      if (line === undefined) {
        clearInterval(ticker);
        tickers.delete(run.id);
        return;
      }
      output(taskId, { agentRunId: run.id }, line);
    }, OUTPUT_MS);
    tickers.set(run.id, ticker);
    return run;
  };

  const runTests = (taskId: string, pass = true) => {
    const state = detailOf(taskId);
    const run: TestRun = {
      id: crypto.randomUUID(),
      taskId,
      command: "npm run test:e2e",
      status: "RUNNING",
      attempt: state.testRuns.length + 1,
      exitCode: null,
      passed: null,
      failed: null,
      skipped: null,
      durationMs: null,
      error: null,
      coverageChecked: true,
      generatedSpecPath: null,
      startedAt: now(),
      completedAt: null,
      createdAt: now(),
    };
    state.testRuns.push(run);
    emit(taskId, "TEST_RUN_STARTED", { testRunId: run.id, attempt: run.attempt });
    output(taskId, { testRunId: run.id }, "$ npm run test:e2e");
    output(taskId, { testRunId: run.id }, "Running 12 tests using 2 workers");
    after(STEP_MS - 200, () => {
      output(taskId, { testRunId: run.id }, pass ? "  12 passed (48.2s)" : "  2 failed\n  10 passed (51.0s)");
      Object.assign(run, {
        status: "COMPLETED",
        exitCode: pass ? 0 : 1,
        passed: pass ? 12 : 10,
        failed: pass ? 0 : 2,
        skipped: 0,
        durationMs: pass ? 48_200 : 51_000,
        completedAt: now(),
      });
      saveLog(taskId, { testRunId: run.id }, `e2e-attempt-${run.attempt}.log`);
      emit(taskId, "TEST_RUN_COMPLETED", { testRunId: run.id, attempt: run.attempt, status: "COMPLETED", exitCode: run.exitCode, passed: run.passed, failed: run.failed, durationMs: run.durationMs });
    });
  };

  /** Steps run STEP_MS apart; a step returning false stops the sequence. */
  const sequence = (steps: Array<() => boolean | void>) => {
    const run = (index: number) => {
      const step = steps[index];
      if (!step) return;
      if (step() === false) return;
      after(STEP_MS, () => run(index + 1));
    };
    run(0);
  };

  const askQuestion = (taskId: string) => {
    const planner = [...detailOf(taskId).agentRuns].reverse().find((r) => r.agent === "PLANNER");
    const question: Question = {
      id: crypto.randomUUID(),
      taskId,
      agentRunId: planner?.id ?? crypto.randomUUID(),
      text: "Should the count include archived templates?",
      options: ["Only active templates", "Active and archived", "Show both counts"],
      status: "PENDING",
      answer: null,
      createdAt: now(),
      answeredAt: null,
    };
    detailOf(taskId).questions.push(question);
    output(taskId, { agentRunId: question.agentRunId }, `Question for operator: ${question.text}`);
    finishRunning(taskId);
    emit(taskId, "QUESTION_CREATED", { question });
  };

  const openPr = (taskId: string) => {
    const task = find(taskId);
    if (task.pullRequestNumber) return;
    const number = 120 + tasks.indexOf(task) + 1;
    const patch = {
      branchName: `sdlc/${taskId.slice(0, 8)}-${slugify(task.title)}`,
      pullRequestNumber: number,
      pullRequestUrl: `https://github.com/sumrender/meme/pull/${number}`,
    };
    patchTask(taskId, patch);
    emit(taskId, "PR_CREATED", { number, url: patch.pullRequestUrl, branch: patch.branchName });
  };

  const requestApproval = (taskId: string) => {
    moveTo(taskId, "HUMAN_REVIEW", "READY");
    const approval: Approval = { id: crypto.randomUUID(), taskId, status: "PENDING", feedback: null, createdAt: now(), decidedAt: null };
    detailOf(taskId).approvals.push(approval);
    emit(taskId, "APPROVAL_REQUESTED", { approvalId: approval.id });
  };

  /** From the end of a Developer run: open the PR, run E2E, run the four Reviewers, then ask for an Approval. */
  const testAndReview = (taskId: string) =>
    sequence([
      () => {
        openPr(taskId);
        moveTo(taskId, "E2E", "RUNNING");
        runTests(taskId);
      },
      () => {
        moveTo(taskId, "AGENT_REVIEW", "RUNNING");
        runAgent(taskId, "REVIEWER_SECURITY");
      },
      () => runAgent(taskId, "REVIEWER_ARCHITECTURE"),
      () => runAgent(taskId, "REVIEWER_QUALITY"),
      () => runAgent(taskId, "REVIEWER_PERFORMANCE"),
      () => undefined,
      () => requestApproval(taskId),
    ]);

  const develop = (taskId: string) =>
    sequence([
      () => {
        moveTo(taskId, "DEVELOPMENT", "RUNNING");
        runAgent(taskId, "DEVELOPER");
      },
      () => undefined,
      () => undefined,
      () => testAndReview(taskId),
    ]);

  const developAndReview = (taskId: string) => {
    patchTask(taskId, { plan: PLAN });
    develop(taskId);
  };

  const deploy = (taskId: string) => {
    const task = find(taskId);
    const deployment: Deployment = {
      id: crypto.randomUUID(),
      taskId,
      target: "FE",
      provider: "CLOUDFLARE",
      commitSha: task.mergedCommitSha ?? "",
      providerRef: `cf-build-${taskId.slice(0, 4)}`,
      status: "PENDING",
      url: null,
      error: null,
      lastPolledAt: null,
      createdAt: now(),
    };
    detailOf(taskId).deployments.push(deployment);
    const update = (to: Deployment["status"], url: string | null) => {
      Object.assign(deployment, { status: to, url, lastPolledAt: now() });
      emit(taskId, "DEPLOYMENT_UPDATED", { deploymentId: deployment.id, target: deployment.target, provider: deployment.provider, to, url });
    };
    sequence([
      () => update("BUILDING", null),
      () => undefined,
      () => {
        update("LIVE", "https://meme-fe.stage.example");
        emit(taskId, "TASK_STATUS_CHANGED", { status: "COMPLETED", from: "RUNNING", to: "COMPLETED", stage: "STAGING" });
      },
    ]);
  };

  const toDetail = (taskId: string): TaskDetail => {
    const task = find(taskId);
    const { activeAgent: _a, pendingQuestion: _q, pendingApprovalId: _p, ...plain } = task;
    const state = detailOf(taskId);
    return {
      ...plain,
      agentRuns: [...state.agentRuns],
      testRuns: [...state.testRuns],
      questions: [...state.questions],
      reviews: [...state.reviews],
      approvals: [...state.approvals],
      deployments: [...state.deployments],
      artifacts: [...state.artifacts],
      events: [...state.events],
    };
  };

  const client: ApiClient = {
    listTasks: async () => tasks,
    createTask: async (input: CreateTaskInput) => {
      const task = makeTask(input);
      emit(task.id, "TASK_CREATED", { task });
      return task;
    },
    startTask: async (taskId) => {
      const task = find(taskId);
      if (task.stage !== "TODO") throw new ApiRequestError(409, "Only TODO Tasks can be started", "NOT_TODO");
      const blocker = findBlockingTask(tasks, taskId);
      if (blocker) throw new ApiRequestError(409, `"${blocker.title}" is still active`, "TASK_ACTIVE");
      sequence([
        () => {
          moveTo(taskId, "PLANNING", "RUNNING");
          runAgent(taskId, "PLANNER");
        },
        () => undefined,
        () => askQuestion(taskId),
      ]);
      return find(taskId);
    },
    answerQuestion: async (taskId, questionId, input: AnswerQuestionInput) => {
      const task = find(taskId);
      if (task.pendingQuestion?.id !== questionId) {
        throw new ApiRequestError(409, "That Question is no longer pending", "QUESTION_NOT_PENDING");
      }
      const question = detailOf(taskId).questions.find((q) => q.id === questionId);
      if (question) Object.assign(question, { status: "ANSWERED", answer: input.answer, answeredAt: now() });
      emit(taskId, "QUESTION_ANSWERED", { questionId, answer: input.answer });
      runAgent(taskId, "PLANNER");
      after(STEP_MS * 2, () => developAndReview(taskId));
      return find(taskId);
    },
    runDemo: async () => {
      const task = await client.createTask({ ...DEMO_TASK });
      return client.startTask(task.id);
    },
    resetDemo: async (): Promise<ResetDemoResult> => {
      for (const timer of timers) clearTimeout(timer);
      for (const ticker of tickers.values()) clearInterval(ticker);
      timers.clear();
      tickers.clear();
      const tasksDeleted = tasks.length;
      tasks = [];
      details.clear();
      return { tasksDeleted, issuesClosed: tasksDeleted, pullRequestsClosed: 0, branchesDeleted: 0 };
    },
    getTask: async (taskId) => toDetail(taskId),
    retryTask: async (taskId) => {
      const task = find(taskId);
      const availability = retryAvailability(task);
      if (!availability.allowed) throw new ApiRequestError(409, availability.reason, "NOT_RETRYABLE");
      emit(taskId, "TASK_RETRIED", { stage: task.stage, previousError: task.error });
      patchTask(taskId, { error: null });
      emit(taskId, "TASK_STATUS_CHANGED", { status: "RUNNING", from: "FAILED", to: "RUNNING", stage: task.stage });
      if (task.stage === "E2E") after(STEP_MS, () => runTests(taskId));
      return toDetail(taskId);
    },
    sendBackTask: async (taskId) => {
      const task = find(taskId);
      const availability = sendBackAvailability(task);
      if (!availability.allowed) throw new ApiRequestError(409, availability.reason, "NOT_SENDABLE");
      patchTask(taskId, { error: null, pendingFeedback: "E2E failed; see the Test Run logs." });
      moveTo(taskId, "DEVELOPMENT", "RUNNING");
      runAgent(taskId, "DEVELOPER");
      return toDetail(taskId);
    },
    decideApproval: async (taskId, approvalId, input: DecideApprovalInput) => {
      const task = find(taskId);
      const approval = detailOf(taskId).approvals.find((a) => a.id === approvalId);
      if (!approval) throw new ApiRequestError(404, "Approval not found", "NOT_FOUND");
      if (approval.status !== "PENDING") throw new ApiRequestError(409, "Approval already decided", "APPROVAL_DECIDED");
      const feedback = input.decision === "REJECTED" ? input.feedback : null;
      Object.assign(approval, { status: input.decision, feedback, decidedAt: now() });
      emit(taskId, "APPROVAL_DECIDED", { approvalId, decision: input.decision, feedback });
      if (input.decision === "APPROVED") {
        const sha = Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, "0")).join("");
        patchTask(taskId, { mergedCommitSha: sha });
        emit(taskId, "MERGED", { sha, pullRequestNumber: task.pullRequestNumber, changedFiles: ["fe/src/components/GalleryHeader.tsx"] });
        moveTo(taskId, "STAGING", "RUNNING");
        after(STEP_MS, () => deploy(taskId));
      } else {
        patchTask(taskId, { pendingFeedback: feedback });
        develop(taskId);
      }
      return toDetail(taskId);
    },
    getProjectSettings: async () => {
      const active = tasks.find((t) => t.stage !== "TODO" && t.stage !== "STAGING") ?? null;
      return { ...FIXTURE_SETTINGS, activeTask: active ? { id: active.id, title: active.title, stage: active.stage } : null };
    },
    fetchArtifactText: async (taskId, artifactId) => {
      const content = detailOf(taskId).logs.get(artifactId);
      if (content === undefined) throw new ApiRequestError(404, "Artifact not found", "NOT_FOUND");
      return content;
    },
    artifactContentUrl: (taskId, artifactId) => `fixture://artifacts/${taskId}/${artifactId}`,
    eventsUrl: (taskId) => (taskId ? `${EVENTS_URL}?taskId=${taskId}` : EVENTS_URL),
  };

  const createEventSource = (url: string) => {
    const taskId = new URL(url).searchParams.get("taskId");
    const source = new FixtureEventSource(taskId, () => sources.delete(source));
    sources.add(source);
    return source;
  };

  if (typeof window !== "undefined") {
    window.sdlcFixture = { dropConnection: () => sources.forEach((s) => s.drop()) };
  }

  tasks = seedTasks();
  for (const task of tasks) seedDetail(task, detailOf(task.id));

  return { client, createEventSource };
}

class FixtureEventSource implements EventSourceLike {
  readyState: number = CONNECTING;
  onopen: EventSource["onopen"] = null;
  onerror: EventSource["onerror"] = null;
  private readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(
    private readonly taskId: string | null,
    private readonly onClose: () => void,
  ) {
    queueMicrotask(() => {
      if (this.readyState !== CONNECTING) return;
      this.readyState = OPEN;
      this.onopen?.call(this.asEventSource(), new Event("open"));
    });
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  deliver(message: SseMessage) {
    if (this.readyState !== OPEN) return;
    const messageTaskId = message.kind === "event" ? message.event.taskId : message.taskId;
    if (this.taskId && messageTaskId !== this.taskId) return;
    const event = new MessageEvent(message.kind, { data: JSON.stringify(message) });
    for (const listener of this.listeners.get(message.kind) ?? []) listener(event);
  }

  /** Simulates the server dropping the connection for good; the client opens a new source. */
  drop() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.onerror?.call(this.asEventSource(), new Event("error"));
  }

  close() {
    this.readyState = CLOSED;
    this.onClose();
  }

  private asEventSource(): EventSource {
    return this as unknown as EventSource;
  }
}

const now = () => new Date().toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const PLAN = `1. In fe/src/components/GalleryHeader.tsx render "{templates.length} templates" next to the title.
2. Guard against templates being undefined while the gallery query is loading.
3. Add an E2E assertion in fe/e2e/gallery.spec.ts for data-testid="template-count".
4. Run npm run build --prefix fe and npm run test:e2e.`;

function makeTask(input: CreateTaskInput, overrides: Partial<BoardTask> = {}): BoardTask {
  const at = now();
  const id = crypto.randomUUID();
  return {
    id,
    projectId: "fixture-project",
    title: input.title,
    description: input.description,
    stage: "TODO",
    status: "READY",
    plan: null,
    issueNumber: 41,
    issueUrl: "https://github.com/sumrender/meme/issues/41",
    branchName: `sdlc/${id.slice(0, 8)}-${slugify(input.title)}`,
    pullRequestNumber: null,
    pullRequestUrl: null,
    mergedCommitSha: null,
    e2eRejectLoopUsed: false,
    e2eCoverageCheckedAt: null,
    e2eGeneratedSpecPath: null,
    e2eReportCommentUrl: null,
    e2eReportVideoUrl: null,
    pendingFeedback: null,
    error: null,
    stageEnteredAt: at,
    createdAt: at,
    updatedAt: at,
    activeAgent: null,
    pendingQuestion: null,
    pendingApprovalId: null,
    ...overrides,
  };
}

function seedTasks(): BoardTask[] {
  return [
    makeTask(
      { title: "Add dark mode toggle to the settings page", description: "Persist the choice and respect prefers-color-scheme." },
      {
        stage: "STAGING",
        status: "COMPLETED",
        plan: PLAN,
        pullRequestNumber: 118,
        pullRequestUrl: "https://github.com/sumrender/meme/pull/118",
        mergedCommitSha: "9f31c8a2d4e5b6c7a8f9e0d1c2b3a4f5e6d7c8b9",
        createdAt: minutesAgo(180),
        stageEnteredAt: minutesAgo(120),
      },
    ),
    makeTask(
      { title: "Sort templates by most recently used", description: "Order the gallery by lastUsedAt descending." },
      {
        stage: "E2E",
        status: "FAILED",
        plan: PLAN,
        pullRequestNumber: 119,
        pullRequestUrl: "https://github.com/sumrender/meme/pull/119",
        e2eRejectLoopUsed: true,
        error: "E2E failed again after the automatic Reject loop (2 failed)",
        createdAt: minutesAgo(80),
        stageEnteredAt: minutesAgo(46),
      },
    ),
    makeTask(
      { title: "Show the template count in the gallery header (rehearsal)", description: "Second rehearsal of the demo task." },
      {
        stage: "HUMAN_REVIEW",
        status: "WAITING",
        plan: PLAN,
        pullRequestNumber: 120,
        pullRequestUrl: "https://github.com/sumrender/meme/pull/120",
        createdAt: minutesAgo(55),
        stageEnteredAt: minutesAgo(15),
      },
    ),
    makeTask({ title: "Fix flaky template search on empty query", description: "" }, { createdAt: minutesAgo(60) }),
    makeTask({ title: "Paginate the template gallery", description: "" }, { createdAt: minutesAgo(30) }),
  ];
}

/** Gives the seeded non-TODO Tasks a plausible history so the detail page has something to show. */
function seedDetail(task: BoardTask, state: DetailState) {
  if (task.stage === "TODO") return;
  const age = (Date.now() - Date.parse(task.createdAt)) / 60_000;
  const event = (type: EventType, payload: Record<string, unknown>, agoMinutes: number) =>
    state.events.push({ id: crypto.randomUUID(), taskId: task.id, type, payload, createdAt: minutesAgo(agoMinutes) });
  const run = (agent: Agent, agoMinutes: number, durationMinutes: number, lines: string[], status: AgentRun["status"] = "COMPLETED"): AgentRun => {
    const row: AgentRun = {
      id: crypto.randomUUID(),
      taskId: task.id,
      agent,
      status,
      attempt: state.agentRuns.filter((r) => r.agent === agent).length + 1,
      opencodeSessionId: `ses_fixture_${agent.toLowerCase()}`,
      model: agent === "DEVELOPER" ? "claude-sonnet-5" : "claude-haiku-4-5-20251001",
      startedAt: minutesAgo(agoMinutes),
      completedAt: minutesAgo(agoMinutes - durationMinutes),
      exitCode: status === "COMPLETED" ? 0 : 1,
      error: null,
      createdAt: minutesAgo(agoMinutes),
    };
    state.agentRuns.push(row);
    event("AGENT_RUN_STARTED", { agentRunId: row.id, agent, attempt: row.attempt, model: row.model }, agoMinutes);
    event("AGENT_RUN_COMPLETED", { agentRunId: row.id, agent, attempt: row.attempt, status }, agoMinutes - durationMinutes);
    const artifact: Artifact = {
      id: crypto.randomUUID(),
      taskId: task.id,
      agentRunId: row.id,
      testRunId: null,
      type: "LOG",
      name: `${agent.toLowerCase()}-attempt-${row.attempt}.log`,
      sizeBytes: 0,
      createdAt: row.completedAt ?? row.createdAt,
    };
    const content = [`Starting ${agent} (attempt ${row.attempt}, model ${row.model})`, ...lines]
      .map((l, i) => `${new Date(Date.parse(row.startedAt!) + i * 4000).toISOString()} ${l}`)
      .join("\n");
    artifact.sizeBytes = content.length;
    state.artifacts.push(artifact);
    state.logs.set(artifact.id, content);
    return row;
  };
  const tests = (pass: boolean, agoMinutes: number) => {
    const output = pass
      ? "Running 12 tests using 2 workers\n\n  12 passed (48.2s)"
      : 'Running 12 tests using 2 workers\n\n  1) gallery.spec.ts:14 › shows template count\n     Expected: "12 templates" Received: "undefined templates"\n\n  2 failed\n  10 passed (51.0s)';
    const row: TestRun = {
      id: crypto.randomUUID(),
      taskId: task.id,
      command: "npm run test:e2e",
      status: "COMPLETED",
      attempt: state.testRuns.length + 1,
      exitCode: pass ? 0 : 1,
      passed: pass ? 12 : 10,
      failed: pass ? 0 : 2,
      skipped: 0,
      durationMs: pass ? 48_200 : 51_000,
      error: null,
      coverageChecked: true,
      generatedSpecPath: null,
      startedAt: minutesAgo(agoMinutes),
      completedAt: minutesAgo(agoMinutes - 1),
      createdAt: minutesAgo(agoMinutes),
    };
    state.testRuns.push(row);
    event("TEST_RUN_STARTED", { testRunId: row.id, attempt: row.attempt }, agoMinutes);
    event("TEST_RUN_COMPLETED", { testRunId: row.id, attempt: row.attempt, status: "COMPLETED", exitCode: row.exitCode, passed: row.passed, failed: row.failed, durationMs: row.durationMs }, agoMinutes - 1);
    const artifact: Artifact = {
      id: crypto.randomUUID(),
      taskId: task.id,
      agentRunId: null,
      testRunId: row.id,
      type: "LOG",
      name: `e2e-attempt-${row.attempt}.log`,
      sizeBytes: output.length,
      createdAt: row.completedAt ?? row.createdAt,
    };
    state.artifacts.push(artifact);
    state.logs.set(artifact.id, `$ npm run test:e2e\n${output}`);
  };
  const stage = (from: Stage, to: Stage, agoMinutes: number) => event("TASK_STAGE_CHANGED", { from, to, status: "RUNNING" }, agoMinutes);
  const planner = ["Cloning at main", "$ npm ci", "[tool] read fe/src/components/GalleryHeader.tsx", "Plan stored"];
  const developer = ["Cloning at main", "[tool] edit fe/src/components/GalleryHeader.tsx", "$ npm run build --prefix fe", "Opened PR"];

  event("TASK_CREATED", { task }, age);
  stage("TODO", "PLANNING", age - 1);
  run("PLANNER", age - 2, 3, planner);
  stage("PLANNING", "DEVELOPMENT", age - 5);
  run("DEVELOPER", age - 6, 12, developer);
  event("PR_CREATED", { number: task.pullRequestNumber, url: task.pullRequestUrl, branch: task.branchName }, age - 18);
  stage("DEVELOPMENT", "E2E", age - 19);

  if (task.stage === "E2E") {
    tests(false, age - 20);
    stage("E2E", "DEVELOPMENT", age - 22);
    run("DEVELOPER", age - 23, 10, developer);
    stage("DEVELOPMENT", "E2E", age - 34);
    tests(false, age - 35);
    event("TASK_STATUS_CHANGED", { status: "FAILED", from: "RUNNING", to: "FAILED", stage: "E2E" }, age - 36);
    event("TASK_FAILED", { stage: "E2E", error: task.error }, age - 36);
    return;
  }

  tests(true, age - 20);
  stage("E2E", "AGENT_REVIEW", age - 22);
  for (const reviewer of REVIEWERS) {
    const r = run(reviewer, age - 23, 2, ["Cloning at task branch", `Verdict: ${REVIEW_OUTPUT[reviewer].verdict}`]);
    const review: Review = { id: crypto.randomUUID(), taskId: task.id, agentRunId: r.id, reviewer, ...REVIEW_OUTPUT[reviewer], createdAt: minutesAgo(age - 25) };
    state.reviews.push(review);
    event("REVIEW_COMPLETED", { reviewId: review.id, reviewer, verdict: review.verdict, findingCount: review.findings.length }, age - 25);
  }
  stage("AGENT_REVIEW", "HUMAN_REVIEW", age - 26);
  if (task.stage === "HUMAN_REVIEW") {
    const pending: Approval = { id: crypto.randomUUID(), taskId: task.id, status: "PENDING", feedback: null, createdAt: minutesAgo(age - 26), decidedAt: null };
    state.approvals.push(pending);
    event("APPROVAL_REQUESTED", { approvalId: pending.id }, age - 26);
    event("TASK_STATUS_CHANGED", { status: "WAITING", from: "RUNNING", to: "WAITING", stage: "HUMAN_REVIEW" }, age - 26);
    Object.assign(task, { pendingApprovalId: pending.id });
    return;
  }
  const approval: Approval = { id: crypto.randomUUID(), taskId: task.id, status: "APPROVED", feedback: null, createdAt: minutesAgo(age - 26), decidedAt: minutesAgo(age - 40) };
  state.approvals.push(approval);
  event("APPROVAL_REQUESTED", { approvalId: approval.id }, age - 26);
  event("APPROVAL_DECIDED", { approvalId: approval.id, decision: "APPROVED", feedback: null }, age - 40);
  event("MERGED", { sha: task.mergedCommitSha, pullRequestNumber: task.pullRequestNumber, changedFiles: ["fe/src/components/SettingsDrawer.tsx"] }, age - 41);
  stage("HUMAN_REVIEW", "STAGING", age - 41);
  const deployment: Deployment = {
    id: crypto.randomUUID(),
    taskId: task.id,
    target: "FE",
    provider: "CLOUDFLARE",
    commitSha: task.mergedCommitSha ?? "",
    providerRef: "cf-build-8e02",
    status: "LIVE",
    url: "https://meme-fe.stage.example",
    error: null,
    lastPolledAt: minutesAgo(age - 45),
    createdAt: minutesAgo(age - 41),
  };
  state.deployments.push(deployment);
  event("DEPLOYMENT_UPDATED", { deploymentId: deployment.id, target: "FE", provider: "CLOUDFLARE", from: "BUILDING", to: "LIVE", url: deployment.url }, age - 45);
  event("TASK_STATUS_CHANGED", { status: "COMPLETED", from: "RUNNING", to: "COMPLETED", stage: "STAGING" }, age - 45);
}
