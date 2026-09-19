import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KanbanBoard } from "~/components/KanbanBoard";

export const Route = createFileRoute("/")({
  component: BoardPage,
});

function BoardPage() {
  const navigate = useNavigate();
  const openTask = (task: { id: string }) => void navigate({ to: "/tasks/$id", params: { id: task.id } });
  return (
    <div className="flex flex-col gap-3 p-4 lg:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <span>sdlc-ai</span>
            <span aria-hidden>/</span>
            <span className="font-medium text-foreground">Board</span>
          </nav>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight">Board</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">One repo · one active task · tasks move automatically over SSE.</p>
        </div>
      </header>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <div className="flex min-w-max items-center gap-1 border-b border-border bg-secondary/40 px-3 pt-2 text-[13px]">
          <span className="rounded-t-md bg-card px-3 py-1.5 font-medium text-foreground shadow-[inset_0_1px_0_hsl(var(--border)),inset_1px_0_0_hsl(var(--border)),inset_-1px_0_0_hsl(var(--border))]">Board</span>
          <span className="px-3 py-1.5 text-muted-foreground">Activity</span>
          <span className="px-3 py-1.5 text-muted-foreground">Deployments</span>
        </div>
        <KanbanBoard onOpenTask={openTask} />
      </div>
    </div>
  );
}
