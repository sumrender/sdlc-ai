import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { TaskDetail } from "@sdlc-ai/shared";
import { activeRuns, latestRun, linesForRun, type ActivityLine, type Run } from "~/lib/task-detail";
import { AGENT_LABEL } from "./TaskCard";

export interface AgentActivityProps {
  task: TaskDetail;
  activity: ActivityLine[];
  /** Opens the LOG Artifact of a finished run. */
  onOpenLog: (run: Run) => void;
}

export function runLabel(run: Run): string {
  return run.kind === "agent" ? AGENT_LABEL[run.run.agent] : "Test Run";
}

/**
 * Timestamped AGENT_OUTPUT lines from the current Agent Run or Test Run,
 * streamed over SSE. Lines live only for this page session; the full record
 * is the run's LOG Artifact once it finishes.
 */
export function AgentActivity({ task, activity, onOpenLog }: AgentActivityProps) {
  const live = activeRuns(task);
  const focus: Run | null = live[live.length - 1] ?? latestRun(task);
  const lines = live.length > 0 ? activity.filter((l) => live.some((r) => (r.kind === "agent" ? l.agentRunId === r.run.id : l.testRunId === r.run.id))) : focus ? linesForRun(activity, focus) : [];
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const pane = paneRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [lines.length]);

  const showRunTag = live.length > 1;
  const tagFor = (line: ActivityLine) => {
    const run = live.find((r) => (r.kind === "agent" ? r.run.id === line.agentRunId : r.run.id === line.testRunId));
    return run ? runLabel(run) : "";
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
        {live.length > 0 ? (
          <p className="flex items-center gap-1.5 font-medium text-blue-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            <span>
              {live.map(runLabel).join(", ")} {live.length > 1 ? "are" : "is"} running
            </span>
          </p>
        ) : focus ? (
          <p className="text-muted-foreground">
            No run is active. Last run: {runLabel(focus)} ({focus.run.status.toLowerCase().replace("_", " ")}).
          </p>
        ) : (
          <p className="text-muted-foreground">No Agent Run yet. Start the Task from the Kanban.</p>
        )}
        {focus && live.length === 0 && (
          <button type="button" onClick={() => onOpenLog(focus)} className="text-blue-700 hover:underline">
            Open its log
          </button>
        )}
      </div>
      <div
        ref={paneRef}
        role="log"
        aria-live="polite"
        aria-label="Agent activity"
        className="h-72 overflow-auto border-t border-border bg-secondary/40 px-4 py-3 font-mono text-[12px] leading-5"
      >
        {lines.length === 0 ? (
          <p className="text-muted-foreground">
            {live.length > 0 ? "Waiting for output…" : "Output appears here while a run is active."}
          </p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="flex gap-3 whitespace-pre-wrap break-words">
              <span className="shrink-0 select-none text-muted-foreground">{time(line.at)}</span>
              {showRunTag && <span className="shrink-0 font-medium text-blue-700">{tagFor(line)}</span>}
              <span>{line.line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour12: false });
