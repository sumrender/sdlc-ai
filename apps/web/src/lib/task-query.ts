import { useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SseMessage, TaskDetail } from "@sdlc-ai/shared";
import { useApi } from "./api-context";
import { connectEventStream, type EventStreamStatus } from "./event-stream";
import { appendActivity, applyEventToDetail, type ActivityLine } from "./task-detail";

export const taskQueryKey = (taskId: string) => ["task", taskId] as const;

export function useTaskQuery(taskId: string) {
  const { client } = useApi();
  return useQuery({ queryKey: taskQueryKey(taskId), queryFn: () => client.getTask(taskId) });
}

export function setTaskDetail(queryClient: QueryClient, detail: TaskDetail) {
  queryClient.setQueryData<TaskDetail>(taskQueryKey(detail.id), detail);
}

const RECONCILE_DELAY_MS = 250;

export interface TaskLive {
  streamStatus: EventStreamStatus;
  /** Ephemeral AGENT_OUTPUT lines received while this page has been open. */
  activity: ActivityLine[];
}

/**
 * Subscribes to the SSE endpoint scoped to one Task. Persisted Events are
 * applied to the cached TaskDetail (and a refetch reconciles anything the
 * payload cannot rebuild); AGENT_OUTPUT lines are kept in memory for the
 * activity feed, since they are persisted only inside the LOG Artifact.
 */
export function useTaskLive(taskId: string): TaskLive {
  const { client, createEventSource } = useApi();
  const queryClient = useQueryClient();
  const [streamStatus, setStreamStatus] = useState<EventStreamStatus>("connecting");
  const [activity, setActivity] = useState<ActivityLine[]>([]);

  useEffect(() => {
    setActivity([]);
    const key = taskQueryKey(taskId);
    let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
    const reconcile = () => {
      if (reconcileTimer) return;
      reconcileTimer = setTimeout(() => {
        reconcileTimer = null;
        void queryClient.invalidateQueries({ queryKey: key });
      }, RECONCILE_DELAY_MS);
    };

    const onMessage = (message: SseMessage) => {
      if (message.kind === "agent_output") {
        if (message.taskId === taskId) setActivity((lines) => appendActivity(lines, message));
        return;
      }
      if (message.event.taskId !== taskId) return;
      // The Task itself is gone: drop the cache so the page shows its
      // not-found state. The Event row is cascade-deleted server-side, so no
      // refetch could ever rebuild anything here.
      if (message.event.type === "TASK_DELETED") {
        queryClient.removeQueries({ queryKey: key });
        return;
      }
      const current = queryClient.getQueryData<TaskDetail>(key);
      if (!current) return reconcile();
      const { detail, reconcile: stale } = applyEventToDetail(current, message.event);
      queryClient.setQueryData(key, detail);
      if (stale) reconcile();
    };

    const dispose = connectEventStream(
      client.eventsUrl(taskId),
      {
        onMessage,
        onReconnect: () => void queryClient.invalidateQueries({ queryKey: key }),
        onStatus: setStreamStatus,
      },
      createEventSource ? { createSource: createEventSource } : {},
    );

    return () => {
      dispose();
      if (reconcileTimer) clearTimeout(reconcileTimer);
    };
  }, [client, createEventSource, queryClient, taskId]);

  return { streamStatus, activity };
}
