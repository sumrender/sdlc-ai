import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreateTaskInputSchema } from "@sdlc-ai/shared";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { useApi } from "~/lib/api-context";
import { upsertTask } from "~/lib/board-query";

export function NewTaskDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const parsed = CreateTaskInputSchema.safeParse({ title, description });

  const create = useMutation({
    mutationFn: () => {
      if (!parsed.success) throw new Error("Title is required");
      return client.createTask(parsed.data);
    },
    onSuccess: (task) => {
      upsertTask(queryClient, task);
      setTitle("");
      setDescription("");
      onOpenChange(false);
    },
  });

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
            <DialogDescription>A GitHub Issue is opened in the Project repository when the Task is created.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="new-task-title">Title</Label>
            <Input id="new-task-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-task-description">Description</Label>
            <Textarea id="new-task-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={5} />
          </div>
          {create.error && <p className="text-sm text-red-300">{create.error.message}</p>}
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
