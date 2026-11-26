import { useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { BoardTask, SseMessage } from "@sdlc-ai/shared";
import { useApi } from "./api-context";
import { applyEventToTasks } from "./board";
import { connectEventStream, type EventStreamStatus } from "./event-stream";
import { projectsQueryKey } from "./settings-query";

export const allTasksQueryKey = ["tasks"] as const;
export const tasksQueryKey = (projectId: string) => ["tasks", projectId] as const;

export function useTasksQuery(projectId: string | undefined) {
  const { client } = useApi();
  return useQuery({
    queryKey: tasksQueryKey(projectId ?? ""),
    queryFn: () => client.listTasks(projectId!),
    enabled: Boolean(projectId),
  });
}

/** Writes one Task into its project's cached list, adding it when new. */
export function upsertTask(queryClient: QueryClient, task: BoardTask) {
  queryClient.setQueryData<BoardTask[]>(tasksQueryKey(task.projectId), (tasks = []) => {
    const index = tasks.findIndex((t) => t.id === task.id);
    if (index === -1) return [...tasks, task];
    const next = [...tasks];
    next[index] = task;
    return next;
  });
}

const RECONCILE_DELAY_MS = 250;

/**
 * Subscribes to the SSE endpoint scoped to one Project and applies every
 * persisted Event to that Project's Tasks cache. Events the board cannot
 * apply, and every reconnect, trigger a refetch to reconcile.
 */
export function useBoardEvents(projectId: string): EventStreamStatus {
  const { client, createEventSource } = useApi();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<EventStreamStatus>("connecting");

  useEffect(() => {
    const key = tasksQueryKey(projectId);
    let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
    const reconcile = () => {
      if (reconcileTimer) return;
      reconcileTimer = setTimeout(() => {
        reconcileTimer = null;
        void queryClient.invalidateQueries({ queryKey: key });
      }, RECONCILE_DELAY_MS);
    };

    const onMessage = (message: SseMessage) => {
      if (message.kind !== "event") return;
      if (message.projectId !== projectId) return;
      if (
        message.event.type === "TASK_STAGE_CHANGED" ||
        message.event.type === "TASK_STATUS_CHANGED" ||
        message.event.type === "TASK_CREATED" ||
        message.event.type === "TASK_DELETED"
      ) {
        void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
      }
      const current = queryClient.getQueryData<BoardTask[]>(key);
      if (!current) return reconcile();
      const { tasks, reconcile: stale } = applyEventToTasks(current, message.event);
      queryClient.setQueryData(key, tasks);
      if (stale) reconcile();
    };

    const dispose = connectEventStream(
      client.eventsUrl({ projectId }),
      {
        onMessage,
        onReconnect: () => void queryClient.invalidateQueries({ queryKey: key }),
        onStatus: setStatus,
      },
      createEventSource ? { createSource: createEventSource } : {},
    );

    return () => {
      dispose();
      if (reconcileTimer) clearTimeout(reconcileTimer);
    };
  }, [client, createEventSource, projectId, queryClient]);

  return status;
}
