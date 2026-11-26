import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import type { Project } from "@sdlc-ai/shared";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useDeleteProject } from "~/lib/settings-query";

export interface DeleteProjectDialogProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteProjectDialog({ project, open, onOpenChange }: DeleteProjectDialogProps) {
  const navigate = useNavigate();
  const [confirmSlug, setConfirmSlug] = useState("");
  const mutation = useDeleteProject(project.id);
  const matches = confirmSlug.trim() === project.slug;

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setConfirmSlug("");
      mutation.reset();
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete project permanently</DialogTitle>
          <DialogDescription>
            Permanently remove {project.name} and every Task, Agent Run, Artifact, Deployment, and encrypted Secret stored under it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            This action cannot be undone. Type{" "}
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">{project.slug}</span> to
            confirm deletion.
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-project-confirm" className="text-xs">
              Project slug
            </Label>
            <Input
              id="delete-project-confirm"
              value={confirmSlug}
              onChange={(e) => setConfirmSlug(e.target.value)}
              placeholder={project.slug}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </div>

          {mutation.isError && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {mutation.error.message}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!matches || mutation.isPending}
            onClick={() => {
              mutation.mutate(undefined, {
                onSuccess: () => {
                  onOpenChange(false);
                  void navigate({ to: "/" });
                },
              });
            }}
          >
            <Trash2 /> {mutation.isPending ? "Deleting…" : "Delete project permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
