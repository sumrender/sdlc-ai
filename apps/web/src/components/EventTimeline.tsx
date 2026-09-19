import type { Event, EventType } from "@sdlc-ai/shared";
import { formatTime } from "~/lib/task-detail";
import { cn } from "~/lib/utils";

const LABEL: Record<EventType, string> = {
  TASK_CREATED: "Task created",
  TASK_STAGE_CHANGED: "Stage changed",
  TASK_STATUS_CHANGED: "Status changed",
  AGENT_RUN_STARTED: "Agent Run started",
  AGENT_RUN_COMPLETED: "Agent Run completed",
  AGENT_RUN_FAILED: "Agent Run failed",
  QUESTION_CREATED: "Question asked",
  QUESTION_ANSWERED: "Question answered",
  CHECKS_STARTED: "Checks started",
  CHECKS_COMPLETED: "Checks completed",
  PR_CREATED: "Pull request opened",
  TEST_RUN_STARTED: "Test Run started",
  TEST_RUN_COMPLETED: "Test Run completed",
  REVIEW_COMPLETED: "Review completed",
  APPROVAL_REQUESTED: "Approval requested",
  APPROVAL_DECIDED: "Approval decided",
  MERGED: "Merged",
  DEPLOYMENT_UPDATED: "Deployment updated",
  TASK_FAILED: "Task failed",
  TASK_RETRIED: "Task retried",
  E2E_COVERAGE_DECIDED: "E2E coverage decided",
  PR_COMMENT_POSTED: "E2E report posted",
};

const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : null);

/** One line of context for an Event, drawn from the fields every emitter includes. */
function summarize(event: Event): string | null {
  const p = event.payload;
  switch (event.type) {
    case "TASK_STAGE_CHANGED":
      return [str(p.from), str(p.to)].filter(Boolean).join(" → ");
    case "TASK_STATUS_CHANGED":
      return [str(p.from), str(p.to) ?? str(p.status)].filter(Boolean).join(" → ");
    case "AGENT_RUN_STARTED":
    case "AGENT_RUN_COMPLETED":
    case "AGENT_RUN_FAILED":
      return [str(p.agent), p.attempt ? `attempt ${str(p.attempt)}` : null].filter(Boolean).join(" · ");
    case "TEST_RUN_COMPLETED":
      return p.passed !== undefined ? `${str(p.passed) ?? 0} passed, ${str(p.failed) ?? 0} failed` : str(p.status);
    case "REVIEW_COMPLETED":
      return [str(p.reviewer), str(p.verdict)].filter(Boolean).join(" · ");
    case "APPROVAL_DECIDED":
      return str(p.decision);
    case "PR_CREATED":
      return p.number ? `#${str(p.number)}` : null;
    case "E2E_COVERAGE_DECIDED":
      return [p.covered ? "covered" : "missing", str(p.generatedSpecPath)].filter(Boolean).join(" · ");
    case "PR_COMMENT_POSTED":
      return str(p.url);
    case "MERGED":
      return str(p.sha)?.slice(0, 7) ?? null;
    case "DEPLOYMENT_UPDATED":
      return [str(p.target), str(p.to)].filter(Boolean).join(" → ");
    case "TASK_FAILED":
      return str(p.error);
    case "TASK_RETRIED":
      return str(p.stage);
    case "QUESTION_ANSWERED":
      return str(p.answer);
    default:
      return null;
  }
}

const TONE: Partial<Record<EventType, string>> = {
  TASK_FAILED: "text-red-300",
  AGENT_RUN_FAILED: "text-red-300",
  TASK_STAGE_CHANGED: "text-sky-300",
  MERGED: "text-emerald-300",
  APPROVAL_DECIDED: "text-amber-300",
  QUESTION_CREATED: "text-amber-300",
};

/** Every persisted Event for the Task, newest first. */
export function EventTimeline({ events }: { events: Event[] }) {
  const ordered = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (ordered.length === 0) return <p className="text-sm text-muted-foreground">No Events yet.</p>;
  return (
    <ol className="flex max-h-96 flex-col gap-1.5 overflow-auto text-xs">
      {ordered.map((event) => {
        const detail = summarize(event);
        return (
          <li key={event.id} className="flex gap-3">
            <time dateTime={event.createdAt} className="shrink-0 font-mono text-muted-foreground/70">
              {formatTime(event.createdAt)}
            </time>
            <span className={cn("shrink-0 font-medium", TONE[event.type])}>{LABEL[event.type]}</span>
            {detail && (
              <span className="min-w-0 truncate text-muted-foreground" title={detail}>
                {detail}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
