import { FileText, Loader2 } from "lucide-react";
import type { RunStatus, TaskDetail } from "@sdlc-ai/shared";
import { Badge, type BadgeProps } from "~/components/ui/badge";
import { allRuns, formatDuration, formatTime, logArtifactFor, runDuration, type Run } from "~/lib/task-detail";
import { runLabel } from "./AgentActivity";

const VARIANT: Record<RunStatus, NonNullable<BadgeProps["variant"]>> = {
  QUEUED: "secondary",
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "destructive",
  TIMED_OUT: "destructive",
  CANCELLED: "outline",
};

export interface RunHistoryProps {
  task: TaskDetail;
  onOpenLog: (run: Run) => void;
}

/** Every Agent Run and Test Run, newest first, each with its LOG Artifact once finished. */
export function RunHistory({ task, onOpenLog }: RunHistoryProps) {
  const runs = allRuns(task);
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">No runs yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-border text-sm">
      {runs.map((entry) => {
        const { run } = entry;
        const log = logArtifactFor(task, entry);
        const live = run.status === "QUEUED" || run.status === "RUNNING";
        return (
          <li key={run.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            {live ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-600" aria-hidden /> : <span className="w-3.5 shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px]">
                {runLabel(entry)} <span className="text-xs text-muted-foreground">attempt {run.attempt}</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {run.startedAt ? formatTime(run.startedAt) : "queued"} · {formatDuration(runDuration(run))}
                {entry.kind === "agent" && entry.run.model ? ` · ${entry.run.model}` : ""}
              </p>
              {run.error && <p className="truncate text-xs text-red-600" title={run.error}>{run.error}</p>}
            </div>
            <Badge variant={VARIANT[run.status]}>{run.status.replace("_", " ")}</Badge>
            {log ? (
              <button
                type="button"
                onClick={() => onOpenLog(entry)}
                className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                aria-label={`Open log of ${runLabel(entry)} attempt ${run.attempt}`}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden /> Log
              </button>
            ) : (
              <span className="w-10" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
