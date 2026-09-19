import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, Plus, RotateCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { useApi } from "~/lib/api-context";
import { tasksQueryKey, upsertTask } from "~/lib/board-query";
import { NewTaskDialog } from "./NewTaskDialog";

export function AppHeader({ nav }: { nav?: ReactNode }) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const runDemo = useMutation({
    mutationFn: () => client.runDemo(),
    onSuccess: (task) => upsertTask(queryClient, task),
  });
  const resetDemo = useMutation({
    mutationFn: () => client.resetDemo(),
    onSuccess: () => {
      queryClient.setQueryData(tasksQueryKey, []);
      void queryClient.invalidateQueries({ queryKey: tasksQueryKey });
    },
  });
  const error = runDemo.error ?? resetDemo.error;

  return (
    <header className="flex items-center justify-between gap-4 border-b border-border/60 px-4 py-3">
      <div className="flex items-center gap-6">
        <span className="text-sm font-semibold tracking-tight">sdlc-ai</span>
        {nav}
      </div>
      <div className="flex items-center gap-2">
        {error && (
          <span role="alert" className="text-xs text-red-300">
            {error.message}
          </span>
        )}
        <Button variant="secondary" size="sm" onClick={() => runDemo.mutate()} disabled={runDemo.isPending}>
          <Play /> Run Demo
        </Button>
        <Button variant="outline" size="sm" onClick={() => setResetOpen(true)} disabled={resetDemo.isPending}>
          <RotateCcw /> Reset Demo
        </Button>
        <Button size="sm" onClick={() => setNewTaskOpen(true)}>
          <Plus /> New Task
        </Button>
      </div>

      <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} />

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the demo?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes every Task in the control plane, closes the Issues and pull requests it opened, and deletes its unmerged
              branches. The Project repository's default branch is untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => resetDemo.mutate()}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
