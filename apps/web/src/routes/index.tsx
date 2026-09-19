import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KanbanBoard } from "~/components/KanbanBoard";

export const Route = createFileRoute("/")({
  component: BoardPage,
});

function BoardPage() {
  const navigate = useNavigate();
  return <KanbanBoard onOpenApproval={(task) => void navigate({ to: "/tasks/$id", params: { id: task.id } })} />;
}
