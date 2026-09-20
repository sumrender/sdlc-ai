import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreateTaskInputSchema, DUPLICATE_TASK_ERROR_CODE } from "@sdlc-ai/shared";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { useApi } from "~/lib/api-context";
import { upsertTask } from "~/lib/board-query";
import { ApiRequestError } from "~/lib/api";

export function NewTaskDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueRef, setIssueRef] = useState("");
  const [pullRef, setPullRef] = useState("");
  const [force, setForce] = useState(false);
  const usingExisting = pullRef.trim().length > 0 || issueRef.trim().length > 0;
  const parsed = CreateTaskInputSchema.safeParse({
    title: title || undefined,
    description,
    issueRef: issueRef.trim() || undefined,
    pullRef: pullRef.trim() || undefined,
    force: force || undefined,
  });

  const create = useMutation({
    mutationFn: () => {
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Title is required");
      return client.createTask(parsed.data);
    },
    onSuccess: (task) => {
      upsertTask(queryClient, task);
      setTitle("");
      setDescription("");
      setIssueRef("");
      setPullRef("");
      setForce(false);
      onOpenChange(false);
    },
  });
  const isDuplicate = create.error instanceof ApiRequestError && create.error.code === DUPLICATE_TASK_ERROR_CODE;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
            <DialogDescription>
              A GitHub Issue is opened when the Task is created. Paste an existing issue or PR to work on it instead — title and
              description are copied from GitHub.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="new-task-issue">Existing GitHub Issue (optional)</Label>
            <Input
              id="new-task-issue"
              value={issueRef}
              onChange={(e) => setIssueRef(e.target.value)}
              placeholder="#123 or https://github.com/owner/repo/issues/123"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-task-pr">Existing PR (optional, wins over issue)</Label>
            <Input
              id="new-task-pr"
              value={pullRef}
              onChange={(e) => setPullRef(e.target.value)}
              placeholder="#124 or https://github.com/owner/repo/pull/124"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-task-title">Title</Label>
            <Input
              id="new-task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus={!usingExisting}
              disabled={usingExisting}
              placeholder={usingExisting ? "Copied from GitHub on create" : undefined}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-task-description">Description</Label>
            <Textarea
              id="new-task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              disabled={usingExisting}
              placeholder={usingExisting ? "Copied from GitHub on create" : undefined}
            />
          </div>
          {create.error && (
            <p className="text-sm text-red-600">
              {create.error.message}
              {isDuplicate && (
                <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => { setForce(true); create.mutate(); }}>
                  A task already exists — create anyway
                </Button>
              )}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!parsed.success || create.isPending}>
              {create.isPending ? "Creating…" : "Create Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
