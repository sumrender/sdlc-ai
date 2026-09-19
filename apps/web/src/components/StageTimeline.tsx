import { Check } from "lucide-react";
import type { Stage, TaskStatus } from "@sdlc-ai/shared";
import { formatTime, type TimelineEntry } from "~/lib/task-detail";
import { cn } from "~/lib/utils";
import { StatusBadge } from "./StatusBadge";

export const STAGE_LABEL: Record<Stage, string> = {
  TODO: "TODO",
  PLANNING: "PLANNING",
  DEVELOPMENT: "DEVELOPMENT",
  E2E: "E2E",
  AGENT_REVIEW: "AGENT REVIEW",
  HUMAN_REVIEW: "HUMAN REVIEW",
  STAGING: "STAGING",
};

export interface StageTimelineProps {
  entries: TimelineEntry[];
  status: TaskStatus;
}

/** The seven Stages as a horizontal stepper: completed, current (with its Status), and upcoming. */
export function StageTimeline({ entries, status }: StageTimelineProps) {
  return (
    <ol aria-label="Stage timeline" className="grid grid-cols-7 gap-2">
      {entries.map((entry, index) => {
        const done = entry.state === "done";
        const current = entry.state === "current";
        return (
          <li key={entry.stage} aria-current={current ? "step" : undefined} className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                  done && "border-emerald-500/60 bg-emerald-500/20 text-emerald-300",
                  current && "border-sky-400 bg-sky-500/20 text-sky-200 ring-2 ring-sky-400/40",
                  entry.state === "upcoming" && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
              </span>
              <span
                aria-hidden
                className={cn("h-px flex-1", done ? "bg-emerald-500/50" : current ? "bg-sky-400/40" : "bg-border")}
              />
            </div>
            <div className="min-w-0">
              <p className={cn("truncate text-xs font-semibold tracking-wide", entry.state === "upcoming" ? "text-muted-foreground" : "text-foreground")}>
                {STAGE_LABEL[entry.stage]}
                {entry.visits > 1 && (
                  <span className="ml-1 font-normal text-amber-300" title="Entered more than once: a Reject loop">
                    ×{entry.visits}
                  </span>
                )}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                {current ? <StatusBadge status={status} /> : entry.enteredAt ? <span>{formatTime(entry.enteredAt)}</span> : <span>—</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
