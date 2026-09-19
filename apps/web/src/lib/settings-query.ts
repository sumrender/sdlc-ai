import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "./api-context";

export const projectSettingsQueryKey = ["project-settings"] as const;

/** GET /project: the Project, GitHub connection, Deploy Targets, and the Manifest read from the repository. */
export function useProjectSettings() {
  const { client } = useApi();
  return useQuery({ queryKey: projectSettingsQueryKey, queryFn: () => client.getProjectSettings() });
}

/** PATCH /project/settings: change the max concurrent Tasks limit. */
export function useUpdateMaxConcurrentTasks() {
  const { client } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (limit: number) => client.updateMaxConcurrentTasks(limit),
    onSuccess: (settings) => queryClient.setQueryData(projectSettingsQueryKey, settings),
  });
}

/** PATCH /project/settings: toggle single-container reuse for a Task. */
export function useUpdateReuseSandbox() {
  const { client } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reuse: boolean) => client.updateReuseSandbox(reuse),
    onSuccess: (settings) => queryClient.setQueryData(projectSettingsQueryKey, settings),
  });
}
