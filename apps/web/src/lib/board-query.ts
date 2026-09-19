import { useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { BoardTask, SseMessage } from "@sdlc-ai/shared";
import { useApi } from "./api-context";
import { applyEventToTasks } from "./board";
import { connectEventStream, type EventStreamStatus } from "./event-stream";

export const tasksQueryKey = ["tasks"] as const;

export function useTasksQuery() {
  const { client } = useApi();
  return useQuery({ queryKey: tasksQueryKey, queryFn: () => client.listTasks() });
}

/** Writes one Task into the cached list, adding it when new. */
export function upsertTask(queryClient: QueryClient, task: BoardTask) {
  queryClient.setQueryData<BoardTask[]>(tasksQueryKey, (tasks = []) => {
    const index = tasks.findIndex((t) => t.id === task.id);
    if (index === -1) return [...tasks, task];
    const next = [...tasks];
    next[index] = task;
    return next;
  });
}

const RECONCILE_DELAY_MS = 250;

/**
 * Subscribes to the SSE endpoint for the lifetime of the component and applies
 * every persisted Event to the Tasks cache. Events the board cannot apply, and
 * every reconnect, trigger a refetch to reconcile. See ADR 0001.
 */
export function useBoardEvents(): EventStreamStatus {
  const { client, createEventSource } = useApi();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<EventStreamStatus>("connecting");

  useEffect(() => {
    let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
    const reconcile = () => {
      if (reconcileTimer) return;
      reconcileTimer = setTimeout(() => {
        reconcileTimer = null;
        void queryClient.invalidateQueries({ queryKey: tasksQueryKey });
      }, RECONCILE_DELAY_MS);
    };

    const onMessage = (message: SseMessage) => {
      if (message.kind !== "event") return;
      const current = queryClient.getQueryData<BoardTask[]>(tasksQueryKey);
      if (!current) return reconcile();
      const { tasks, reconcile: stale } = applyEventToTasks(current, message.event);
      queryClient.setQueryData(tasksQueryKey, tasks);
      if (stale) reconcile();
    };

    const dispose = connectEventStream(
      client.eventsUrl(),
      {
        onMessage,
        onReconnect: () => void queryClient.invalidateQueries({ queryKey: tasksQueryKey }),
        onStatus: setStatus,
      },
      createEventSource ? { createSource: createEventSource } : {},
    );

    return () => {
      dispose();
      if (reconcileTimer) clearTimeout(reconcileTimer);
    };
  }, [client, createEventSource, queryClient]);

  return status;
}
