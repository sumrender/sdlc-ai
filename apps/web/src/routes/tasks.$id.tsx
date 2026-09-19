import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/tasks/$id")({
  component: TaskDetailPage,
});

function TaskDetailPage() {
  const { id } = Route.useParams();
  return (
    <div className="p-6">
      <p className="text-xs text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          ← Kanban
        </Link>
      </p>
      <h1 className="mt-2 text-lg font-semibold">Task {id}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Task detail lands with issue #6.</p>
    </div>
  );
}
