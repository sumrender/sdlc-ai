import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LayoutGroup } from "motion/react";
import type { BoardTask } from "@sdlc-ai/shared";
import { groupTasksByStage, startAvailability } from "~/lib/board";
import { upsertTask, useBoardEvents, useTasksQuery } from "~/lib/board-query";
import { useApi } from "~/lib/api-context";
import { KanbanColumn } from "./KanbanColumn";
import { TaskCard } from "./TaskCard";

export interface KanbanBoardProps {
  /** Called when any card is clicked; opens the Task detail page. */
  onOpenTask: (task: BoardTask) => void;
}

export function KanbanBoard({ onOpenTask }: KanbanBoardProps) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const tasksQuery = useTasksQuery();
  const streamStatus = useBoardEvents();

  const start = useMutation({
    mutationFn: (taskId: string) => client.startTask(taskId),
    onSuccess: (task) => upsertTask(queryClient, task),
  });

  const tasks = tasksQuery.data ?? [];

  if (tasksQuery.isPending) {
    return <p className="p-6 text-sm text-muted-foreground">Loading Tasks…</p>;
  }
  if (tasksQuery.isError) {
    return (
      <p role="alert" className="p-6 text-sm text-red-300">
        Could not load Tasks: {tasksQuery.error.message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {(streamStatus === "reconnecting" || start.error) && (
        <div role="status" className="flex flex-wrap gap-4 text-xs">
          {streamStatus === "reconnecting" && <span className="text-amber-300">Live updates disconnected. Reconnecting…</span>}
          {start.error && <span className="text-red-300">Start refused: {start.error.message}</span>}
        </div>
      )}

      <LayoutGroup>
        <div className="grid grid-cols-7 gap-3">
          {groupTasksByStage(tasks).map(({ stage, tasks: inStage }) => (
            <KanbanColumn key={stage} stage={stage} count={inStage.length}>
              {inStage.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  start={
                    task.stage === "TODO"
                      ? {
                          availability: startAvailability(tasks, task),
                          onStart: () => start.mutate(task.id),
                          pending: start.isPending && start.variables === task.id,
                        }
                      : undefined
                  }
                  onOpen={() => onOpenTask(task)}
                />
              ))}
            </KanbanColumn>
          ))}
        </div>
      </LayoutGroup>
    </div>
  );
}
