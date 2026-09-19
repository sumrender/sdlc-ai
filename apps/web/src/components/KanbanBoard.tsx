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
    <div className="flex flex-col gap-3">
      {(streamStatus === "reconnecting" || start.error) && (
        <div role="status" className="flex flex-wrap gap-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px]">
          {streamStatus === "reconnecting" && <span className="text-amber-800">Live updates disconnected. Reconnecting…</span>}
          {start.error && <span className="text-red-700">Start refused: {start.error.message}</span>}
        </div>
      )}

      <LayoutGroup>
        <div className="grid min-w-[1400px] grid-cols-7 gap-3 p-4 lg:p-5">
          {groupTasksByStage(tasks).map(({ stage, tasks: inStage }) => (
            <KanbanColumn key={stage} stage={stage} count={inStage.length}>
              {inStage.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-2 py-4 text-center text-[11px] text-muted-foreground">
                  No tasks
                </p>
              ) : (
                inStage.map((task) => (
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
                ))
              )}
            </KanbanColumn>
          ))}
        </div>
      </LayoutGroup>
    </div>
  );
}
