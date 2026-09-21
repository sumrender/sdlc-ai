import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { closableIssue, closablePullRequest, type DeleteTaskInput, type TaskDetail } from "@sdlc-ai/shared";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { useApi } from "~/lib/api-context";
import { tasksQueryKey } from "~/lib/board-query";
import { taskQueryKey } from "~/lib/task-query";
import { cn } from "~/lib/utils";

export interface DeleteTaskDialogProps {
  task: TaskDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Delete confirmation. Lists what disappears with the Task and offers to close
 * the GitHub issue and PR — each checkbox only when that ref exists (a merged
 * PR is already closed, so it never offers one). Deleting also stops live runs.
 */
export function DeleteTaskDialog({ task, open, onOpenChange }: DeleteTaskDialogProps) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [closeIssue, setCloseIssue] = useState(false);
  const [closePullRequest, setClosePullRequest] = useState(false);

  const canCloseIssue = closableIssue(task);
  const canClosePullRequest = closablePullRequest(task);

  const submit = useMutation({
    mutationFn: (input: DeleteTaskInput) => client.deleteTask(task.id, input),
    onSuccess: () => {
      // The Task is gone server-side: drop its caches and return to the board.
      queryClient.removeQueries({ queryKey: taskQueryKey(task.id) });
      void queryClient.invalidateQueries({ queryKey: tasksQueryKey });
      onOpenChange(false);
      void navigate({ to: "/" });
    },
  });

  const nothingToClose = !canCloseIssue && !canClosePullRequest;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete task</DialogTitle>
          <DialogDescription className="sr-only">Permanently remove this task and everything it produced.</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Permanently delete <span className="font-medium text-foreground">{task.title}</span> — its runs, artifacts, and events. Any live
          agent run is stopped first. This cannot be undone.
        </p>

        {!nothingToClose && (
          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Also on GitHub</legend>
            {canCloseIssue && (
              <CheckboxRow
                id={`delete-close-issue-${task.id}`}
                checked={closeIssue}
                onChange={setCloseIssue}
                label={`Close issue #${task.issueNumber}`}
              />
            )}
            {canClosePullRequest && (
              <CheckboxRow
                id={`delete-close-pr-${task.id}`}
                checked={closePullRequest}
                onChange={setClosePullRequest}
                label={`Close pull request #${task.pullRequestNumber}`}
              />
            )}
          </fieldset>
        )}

        {submit.error && (
          <p role="alert" className="text-sm text-red-600">
            {submit.error.message}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => submit.mutate({ closeIssue, closePullRequest })} disabled={submit.isPending}>
            <Trash2 /> {submit.isPending ? "Deleting…" : "Delete task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CheckboxRowProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

function CheckboxRow({ id, checked, onChange, label }: CheckboxRowProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={cn("h-4 w-4 rounded border-input accent-red-600", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
      />
      <label htmlFor={id} className="text-sm select-none">
        {label}
      </label>
    </div>
  );
}
