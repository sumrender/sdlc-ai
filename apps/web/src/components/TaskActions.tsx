import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleStop, GitBranch, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { retryAvailability, sendBackAvailability, stopAvailability, type TaskDetail } from "@sdlc-ai/shared";
import { Button } from "~/components/ui/button";
import { DeleteTaskDialog } from "~/components/DeleteTaskDialog";
import { useApi } from "~/lib/api-context";
import { tasksQueryKey } from "~/lib/board-query";
import { setTaskDetail } from "~/lib/task-query";

export interface TaskActionsProps {
  task: TaskDetail;
}

/**
 * Detail-page actions: Retry after a failure, Send back after a spent E2E
 * reject loop, Stop while a run is live, and Delete at any time.
 */
export function TaskActions({ task }: TaskActionsProps) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const onSuccess = (detail: TaskDetail) => {
    setTaskDetail(queryClient, detail);
    void queryClient.invalidateQueries({ queryKey: tasksQueryKey });
  };
  const retry = useMutation({ mutationFn: () => client.retryTask(task.id), onSuccess });
  const retryNewBranch = useMutation({ mutationFn: () => client.retryWithNewBranchTask(task.id), onSuccess });
  const sendBack = useMutation({ mutationFn: () => client.sendBackTask(task.id), onSuccess });
  const stop = useMutation({
    mutationFn: () => client.stopTask(task.id),
    onSuccess,
    // A stopped Task must leave the board's RUNNING state immediately; the
    // SSE TASK_STATUS_CHANGED covers it, but not when the stream is down.
    onError: () => void queryClient.invalidateQueries({ queryKey: tasksQueryKey }),
  });

  const canRetry = retryAvailability(task);
  const canSendBack = sendBackAvailability(task);
  const canStop = stopAvailability(task);
  if (!canRetry.allowed && !canSendBack.allowed && !canStop.allowed) {
    // Delete is offered on every Task, including COMPLETED ones.
    return <TaskActionsWithDelete task={task} deleteOpen={deleteOpen} setDeleteOpen={setDeleteOpen} others={null} />;
  }
  const error = retry.error ?? retryNewBranch.error ?? sendBack.error ?? stop.error;
  const busy = retry.isPending || retryNewBranch.isPending || sendBack.isPending || stop.isPending;

  return (
    <TaskActionsWithDelete
      task={task}
      deleteOpen={deleteOpen}
      setDeleteOpen={setDeleteOpen}
      others={
        <div className="flex flex-wrap items-center gap-2">
          {canStop.allowed && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => stop.mutate()}
              disabled={busy}
              title="Cancel live runs and park the task as failed"
            >
              <CircleStop /> {stop.isPending ? "Stopping…" : "Stop"}
            </Button>
          )}
          {canRetry.allowed && (
            <Button size="sm" onClick={() => retry.mutate()} disabled={busy} title={`Re-run ${task.stage.replace("_", " ")} from scratch`}>
              <RotateCcw /> {retry.isPending ? "Retrying…" : task.stage === "STAGING" ? "Retry (re-poll)" : "Retry"}
            </Button>
          )}
          {canRetry.allowed && task.stage !== "STAGING" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (window.confirm(`Give this task a fresh branch (${task.branchName} will be abandoned) and retry?`)) retryNewBranch.mutate();
              }}
              disabled={busy}
              title="Clear branch/PR refs and retry on a fresh branch"
            >
              <GitBranch /> {retryNewBranch.isPending ? "Retrying…" : "Retry with new branch"}
            </Button>
          )}
          {canSendBack.allowed && (
            <Button size="sm" variant="secondary" onClick={() => sendBack.mutate()} disabled={busy} title="New Developer run with the E2E failure as feedback">
              <Undo2 /> {sendBack.isPending ? "Sending back…" : "Send back to Development"}
            </Button>
          )}
          {error && (
            <span role="alert" className="text-xs text-red-600">
              {error.message}
            </span>
          )}
        </div>
      }
    />
  );
}

interface WithDeleteProps {
  task: TaskDetail;
  deleteOpen: boolean;
  setDeleteOpen: (open: boolean) => void;
  /** The other action buttons, or null when none apply. */
  others: React.ReactNode | null;
}

/** Wraps the other buttons with the Delete button and its confirm dialog. */
function TaskActionsWithDelete({ task, deleteOpen, setDeleteOpen, others }: WithDeleteProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {others}
      <Button
        size="sm"
        variant="ghost"
        className="text-red-600 hover:bg-red-50 hover:text-red-700"
        onClick={() => setDeleteOpen(true)}
        title="Delete this task and everything it produced"
      >
        <Trash2 /> Delete
      </Button>
      {/* Remounting on open resets the checkboxes so a reopened dialog never
          carries the previous session's choices. */}
      <DeleteTaskDialog task={task} open={deleteOpen} onOpenChange={setDeleteOpen} key={deleteOpen ? "open" : "closed"} />
    </div>
  );
}
