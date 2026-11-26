import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "./api-context";

export const projectsQueryKey = ["projects"] as const;
export const projectSettingsQueryKey = (projectId: string) => ["project-settings", projectId] as const;

export function useProjectsQuery() {
  const { client } = useApi();
  return useQuery({ queryKey: projectsQueryKey, queryFn: () => client.listProjects() });
}

/** GET /projects/:projectId: the Project, GitHub connection, Deploy Targets, and Manifest. */
export function useProjectSettings(projectId: string | undefined) {
  const { client } = useApi();
  return useQuery({
    queryKey: projectSettingsQueryKey(projectId ?? ""),
    queryFn: () => client.getProjectSettings(projectId!),
    enabled: Boolean(projectId),
  });
}

/** PATCH /projects/:projectId/settings: change the max concurrent Tasks limit. */
export function useUpdateMaxConcurrentTasks(projectId: string) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (limit: number) => client.updateMaxConcurrentTasks(projectId, limit),
    onSuccess: (settings) => {
      queryClient.setQueryData(projectSettingsQueryKey(projectId), settings);
      queryClient.setQueryData(projectSettingsQueryKey(settings.project.id), settings);
      queryClient.setQueryData(projectSettingsQueryKey(settings.project.slug), settings);
      void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
    },
  });
}

/** PATCH /projects/:projectId/settings: toggle single-container reuse for a Task. */
export function useUpdateReuseSandbox(projectId: string) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reuse: boolean) => client.updateReuseSandbox(projectId, reuse),
    onSuccess: (settings) => {
      queryClient.setQueryData(projectSettingsQueryKey(projectId), settings);
      queryClient.setQueryData(projectSettingsQueryKey(settings.project.id), settings);
      queryClient.setQueryData(projectSettingsQueryKey(settings.project.slug), settings);
    },
  });
}

/** POST /projects/reload: re-import sdlc.config.ts, sync DB projects, and clear warm containers for changed slugs. */
export function useReloadProjectsConfig() {
  const { client } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.reloadProjectsConfig(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["project-settings"] });
    },
  });
}
