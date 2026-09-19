import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Undo2 } from "lucide-react";
import { retryAvailability, sendBackAvailability, type TaskDetail } from "@sdlc-ai/shared";
import { Button } from "~/components/ui/button";
import { useApi } from "~/lib/api-context";
import { tasksQueryKey } from "~/lib/board-query";
import { setTaskDetail } from "~/lib/task-query";

export interface TaskActionsProps {
  task: TaskDetail;
}

/** Retry on a FAILED Task; Send back to Development when the Task FAILED in E2E after its Reject loop. */
export function TaskActions({ task }: TaskActionsProps) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const onSuccess = (detail: TaskDetail) => {
    setTaskDetail(queryClient, detail);
    void queryClient.invalidateQueries({ queryKey: tasksQueryKey });
  };
  const retry = useMutation({ mutationFn: () => client.retryTask(task.id), onSuccess });
  const sendBack = useMutation({ mutationFn: () => client.sendBackTask(task.id), onSuccess });

  const canRetry = retryAvailability(task);
  const canSendBack = sendBackAvailability(task);
  if (!canRetry.allowed && !canSendBack.allowed) return null;
  const error = retry.error ?? sendBack.error;
  const busy = retry.isPending || sendBack.isPending;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRetry.allowed && (
        <Button size="sm" onClick={() => retry.mutate()} disabled={busy} title={`Re-run ${task.stage.replace("_", " ")} from scratch`}>
          <RotateCcw /> {retry.isPending ? "Retrying…" : task.stage === "STAGING" ? "Retry (re-poll)" : "Retry"}
        </Button>
      )}
      {canSendBack.allowed && (
        <Button size="sm" variant="secondary" onClick={() => sendBack.mutate()} disabled={busy} title="New Developer run with the E2E failure as feedback">
          <Undo2 /> {sendBack.isPending ? "Sending back…" : "Send back to Development"}
        </Button>
      )}
      {error && (
        <span role="alert" className="text-xs text-red-300">
          {error.message}
        </span>
      )}
    </div>
  );
}
