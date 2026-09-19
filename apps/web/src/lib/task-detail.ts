import {
  STAGES,
  TaskStageChangedPayloadSchema,
  TaskStatusChangedPayloadSchema,
  AgentRunStartedPayloadSchema,
  type AgentRun,
  type Artifact,
  type Event,
  type SseMessage,
  type Stage,
  type TaskDetail,
  type TestRun,
} from "@sdlc-ai/shared";
import { z } from "zod";

// ---- Stage timeline -------------------------------------------------------

export type TimelineState = "done" | "current" | "upcoming";

export interface TimelineEntry {
  stage: Stage;
  state: TimelineState;
  /** When the Task most recently entered this Stage, if it ever has. */
  enteredAt: string | null;
  /** How many times the Task entered this Stage; more than once means a Reject loop. */
  visits: number;
}

export function buildTimeline(task: Pick<TaskDetail, "stage" | "status" | "events" | "createdAt">): TimelineEntry[] {
  const currentIndex = STAGES.indexOf(task.stage);
  const completed = task.stage === "STAGING" && task.status === "COMPLETED";
  const entered = new Map<Stage, { at: string; visits: number }>();
  entered.set("TODO", { at: task.createdAt, visits: 1 });
  for (const event of task.events) {
    if (event.type !== "TASK_STAGE_CHANGED") continue;
    const parsed = TaskStageChangedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) continue;
    const previous = entered.get(parsed.data.to);
    entered.set(parsed.data.to, { at: event.createdAt, visits: (previous?.visits ?? 0) + 1 });
  }
  return STAGES.map((stage, index) => {
    const info = entered.get(stage);
    const state: TimelineState = completed || index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
    return { stage, state, enteredAt: info?.at ?? null, visits: info?.visits ?? 0 };
  });
}

// ---- Runs -----------------------------------------------------------------

export type Run = { kind: "agent"; run: AgentRun } | { kind: "test"; run: TestRun };

const isLive = (status: AgentRun["status"]) => status === "QUEUED" || status === "RUNNING";

/** Every Agent Run and Test Run, newest first. */
export function allRuns(task: Pick<TaskDetail, "agentRuns" | "testRuns">): Run[] {
  const runs: Run[] = [
    ...task.agentRuns.map((run): Run => ({ kind: "agent", run })),
    ...task.testRuns.map((run): Run => ({ kind: "test", run })),
  ];
  return runs.sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt));
}

/** The Agent Runs or Test Run active right now, oldest first (Reviewers run in parallel). */
export function activeRuns(task: Pick<TaskDetail, "agentRuns" | "testRuns">): Run[] {
  return allRuns(task)
    .filter((r) => isLive(r.run.status))
    .reverse();
}

/** The most recent run, live or finished. */
export function latestRun(task: Pick<TaskDetail, "agentRuns" | "testRuns">): Run | null {
  return allRuns(task)[0] ?? null;
}

export function logArtifactFor(task: Pick<TaskDetail, "artifacts">, run: Run): Artifact | null {
  return (
    task.artifacts.find(
      (a) => a.type === "LOG" && (run.kind === "agent" ? a.agentRunId === run.run.id : a.testRunId === run.run.id),
    ) ?? null
  );
}

export function artifactsForTestRun(task: Pick<TaskDetail, "artifacts">, testRunId: string): Artifact[] {
  return task.artifacts.filter((a) => a.testRunId === testRunId && a.type !== "LOG");
}

/** The Playwright HTML report entry point among a Test Run's Artifacts, if it was copied out. */
export function findReport(artifacts: readonly Artifact[]): Artifact | null {
  return artifacts.find((a) => a.type === "TEST_REPORT" && /(^|\/)index\.html$/.test(a.name)) ?? null;
}

// ---- Activity feed --------------------------------------------------------

export interface ActivityLine {
  id: string;
  at: string;
  line: string;
  agentRunId: string | null;
  testRunId: string | null;
}

export const MAX_ACTIVITY_LINES = 1000;

export function appendActivity(lines: readonly ActivityLine[], message: Extract<SseMessage, { kind: "agent_output" }>): ActivityLine[] {
  const next: ActivityLine[] = [
    ...lines,
    { id: crypto.randomUUID(), at: message.at, line: message.line, agentRunId: message.agentRunId, testRunId: message.testRunId },
  ];
  return next.length > MAX_ACTIVITY_LINES ? next.slice(next.length - MAX_ACTIVITY_LINES) : next;
}

export function linesForRun(lines: readonly ActivityLine[], run: Run): ActivityLine[] {
  return lines.filter((l) => (run.kind === "agent" ? l.agentRunId === run.run.id : l.testRunId === run.run.id));
}

// ---- Applying Events to the cached detail ---------------------------------

const TaskFailedPayloadSchema = z.object({ error: z.string().nullable().optional() });
const PrCreatedPayloadSchema = z.object({
  number: z.number().int().nullable().optional(),
  url: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
});
const DeploymentUpdatedPayloadSchema = z.object({
  deploymentId: z.string(),
  to: z.enum(["PENDING", "BUILDING", "LIVE", "FAILED", "TIMED_OUT"]),
  url: z.string().nullable().optional(),
});

export interface ApplyDetailResult {
  detail: TaskDetail;
  /** True when the Event touched an entity the page cannot rebuild from the payload; refetch. */
  reconcile: boolean;
}

/**
 * Applies one Event to the cached TaskDetail. Every Event is appended to the
 * timeline; Task-level fields are patched from the payload; anything that
 * changes a run, Review, Question, Approval, Artifact, or Deployment asks for a
 * refetch so the page shows the persisted row rather than a guess.
 */
export function applyEventToDetail(detail: TaskDetail, event: Event): ApplyDetailResult {
  if (event.taskId !== detail.id) return { detail, reconcile: false };
  const events = detail.events.some((e) => e.id === event.id) ? detail.events : [...detail.events, event];
  const base: TaskDetail = { ...detail, events, updatedAt: event.createdAt };

  switch (event.type) {
    case "TASK_STAGE_CHANGED": {
      const parsed = TaskStageChangedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return { detail: base, reconcile: true };
      return {
        detail: { ...base, stage: parsed.data.to, status: parsed.data.status, stageEnteredAt: event.createdAt, error: null },
        reconcile: true,
      };
    }
    case "TASK_STATUS_CHANGED": {
      const parsed = TaskStatusChangedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return { detail: base, reconcile: true };
      return { detail: { ...base, status: parsed.data.status }, reconcile: false };
    }
    case "TASK_FAILED": {
      const parsed = TaskFailedPayloadSchema.safeParse(event.payload);
      return { detail: { ...base, status: "FAILED", error: parsed.success ? (parsed.data.error ?? base.error) : base.error }, reconcile: false };
    }
    case "TASK_RETRIED":
      return { detail: { ...base, error: null }, reconcile: true };
    case "PR_CREATED": {
      const parsed = PrCreatedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return { detail: base, reconcile: true };
      return {
        detail: {
          ...base,
          pullRequestNumber: parsed.data.number ?? base.pullRequestNumber,
          pullRequestUrl: parsed.data.url ?? base.pullRequestUrl,
          branchName: parsed.data.branch ?? base.branchName,
        },
        reconcile: false,
      };
    }
    case "AGENT_RUN_STARTED": {
      // Show the run immediately so the activity feed has a header before the refetch lands.
      const parsed = AgentRunStartedPayloadSchema.safeParse(event.payload);
      if (!parsed.success || base.agentRuns.some((r) => r.id === parsed.data.agentRunId)) return { detail: base, reconcile: true };
      const stub: AgentRun = {
        id: parsed.data.agentRunId,
        taskId: base.id,
        agent: parsed.data.agent,
        status: "RUNNING",
        attempt: 1,
        opencodeSessionId: null,
        model: "",
        startedAt: event.createdAt,
        completedAt: null,
        exitCode: null,
        error: null,
        createdAt: event.createdAt,
      };
      return { detail: { ...base, status: "RUNNING", agentRuns: [...base.agentRuns, stub] }, reconcile: true };
    }
    case "DEPLOYMENT_UPDATED": {
      const parsed = DeploymentUpdatedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return { detail: base, reconcile: true };
      const { deploymentId, to, url } = parsed.data;
      const known = base.deployments.some((d) => d.id === deploymentId);
      return {
        detail: {
          ...base,
          deployments: base.deployments.map((d) => (d.id === deploymentId ? { ...d, status: to, url: url ?? d.url, lastPolledAt: event.createdAt } : d)),
        },
        reconcile: !known,
      };
    }
    default:
      return { detail: base, reconcile: true };
  }
}

// ---- Formatting -----------------------------------------------------------

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function runDuration(run: { startedAt: string | null; completedAt: string | null }, now = Date.now()): number | null {
  if (!run.startedAt) return null;
  const end = run.completedAt ? Date.parse(run.completedAt) : now;
  return Math.max(0, end - Date.parse(run.startedAt));
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export const formatTime = (iso: string) => timeFormat.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
