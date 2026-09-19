import { motion } from "motion/react";
import { Loader2, MessageCircleQuestion, ShieldCheck } from "lucide-react";
import type { Agent, BoardTask } from "@sdlc-ai/shared";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { StartAvailability } from "~/lib/board";
import { StatusBadge } from "./StatusBadge";

export const AGENT_LABEL: Record<Agent, string> = {
  PLANNER: "Planner",
  DEVELOPER: "Developer",
  REVIEWER_SECURITY: "Security Reviewer",
  REVIEWER_ARCHITECTURE: "Architecture Reviewer",
  REVIEWER_QUALITY: "Quality Reviewer",
  REVIEWER_PERFORMANCE: "Performance Reviewer",
};

export interface TaskCardProps {
  task: BoardTask;
  /** Present only for TODO cards. */
  start?: { availability: StartAvailability; onStart: () => void; pending: boolean };
  /** Fallback when no onOpen is provided; the board always passes onOpen so every card opens its detail page. */
  onOpenPending?: () => void;
  /** Opens the Task detail page; used for every card in every stage and status. */
  onOpen?: () => void;
}

export function TaskCard({ task, start, onOpenPending, onOpen }: TaskCardProps) {
  const waiting = task.status === "WAITING";
  const titleId = `task-${task.id}-title`;
  const activate = onOpen ?? onOpenPending;
  const clickable = Boolean(activate);

  return (
    <motion.article
      layout
      layoutId={task.id}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 32 }}
      aria-labelledby={titleId}
      data-status={task.status}
      draggable={false}
      onClick={activate}
      onKeyDown={
        activate
          ? (e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                activate();
              }
            }
          : undefined
      }
      role="article"
      tabIndex={clickable ? 0 : undefined}
      className={cn(
        "select-none rounded-lg border border-border bg-card p-3 text-card-foreground",
        clickable && "cursor-pointer hover:border-input hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        waiting && "border-amber-300 bg-amber-50/60 hover:bg-amber-50 focus-visible:ring-amber-400",
        task.status === "FAILED" && "border-red-300",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 id={titleId} className="text-[13px] font-medium leading-snug">
          {task.title}
        </h3>
        <StatusBadge status={task.status} />
      </div>

      {task.status === "RUNNING" && task.activeAgent && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-blue-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          <span>{AGENT_LABEL[task.activeAgent]}</span>
        </p>
      )}

      {waiting && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700">
          {task.pendingQuestion ? <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
          <span>{task.pendingQuestion ? "Planner has a Question" : "Awaiting your Approval"}</span>
        </p>
      )}

      {task.status === "FAILED" && task.error && (
        <p className="mt-2 line-clamp-2 text-xs text-red-600" title={task.error}>
          {task.error}
        </p>
      )}

      {start && (
        <div className="mt-3">
          <Button
            size="sm"
            className="w-full"
            disabled={!start.availability.allowed || start.pending}
            onClick={(e) => {
              e.stopPropagation();
              start.onStart();
            }}
            aria-describedby={start.availability.allowed ? undefined : `task-${task.id}-start-reason`}
          >
            {start.pending ? "Starting…" : "Start"}
          </Button>
          {!start.availability.allowed && (
            <p id={`task-${task.id}-start-reason`} className="mt-1.5 text-xs text-muted-foreground">
              {start.availability.reason}
            </p>
          )}
        </div>
      )}
    </motion.article>
  );
}
