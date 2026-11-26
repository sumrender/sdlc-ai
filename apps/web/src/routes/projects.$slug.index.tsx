import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { KanbanBoard } from "~/components/KanbanBoard";
import { useProjectSettings } from "~/lib/settings-query";
import { LAST_PROJECT_STORAGE_KEY } from "./index";

export const Route = createFileRoute("/projects/$slug/")({
  component: ProjectBoardPage,
});

function ProjectBoardPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const settings = useProjectSettings(slug);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, slug);
    }
  }, [slug]);

  const openTask = (task: { id: string }) => void navigate({ to: "/tasks/$id", params: { id: task.id } });

  if (settings.isPending) {
    return <p className="p-6 text-sm text-muted-foreground">Loading {slug}…</p>;
  }
  if (settings.isError) {
    return (
      <div className="p-6">
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load project "{slug}": {settings.error.message}
        </p>
      </div>
    );
  }

  const { project, activeTaskCount, maxConcurrentTasks, globalActiveTaskCount, maxGlobalConcurrentTasks } = settings.data;
  const subtitle = `${project.owner}/${project.repo} (${project.defaultBranch}) · ${activeTaskCount} of ${maxConcurrentTasks} project slots · ${globalActiveTaskCount} of ${maxGlobalConcurrentTasks} host slots · live over SSE.`;

  return (
    <div className="flex flex-col gap-3 p-4 lg:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <span>{project.name}</span>
            <span aria-hidden>/</span>
            <span className="font-medium text-foreground">Board</span>
          </nav>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
            <Link
              to="/projects/$slug/settings"
              params={{ slug }}
              className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Settings
            </Link>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>
        </div>
      </header>
      {project.archivedAt !== null && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span>This project is archived. New tasks cannot be created or started until you restore it.</span>
          <Link to="/projects/$slug/settings" params={{ slug }} className="font-medium underline">
            Open Settings to restore
          </Link>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <div className="flex min-w-max items-center gap-1 border-b border-border bg-secondary/40 px-3 pt-2 text-[13px]">
          <span className="rounded-t-md bg-card px-3 py-1.5 font-medium text-foreground shadow-[inset_0_1px_0_hsl(var(--border)),inset_1px_0_0_hsl(var(--border)),inset_-1px_0_0_hsl(var(--border))]">Board</span>
          <span className="px-3 py-1.5 text-muted-foreground">Activity</span>
          <span className="px-3 py-1.5 text-muted-foreground">Deployments</span>
        </div>
        <KanbanBoard projectId={project.id} projectSlug={slug} onOpenTask={openTask} />
      </div>
    </div>
  );
}
