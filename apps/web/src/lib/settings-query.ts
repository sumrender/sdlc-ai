import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateProjectInputRaw, ProjectSettings, TestConnectionInput, UpdateProjectInputRaw, UpsertSecretInput } from "@sdlc-ai/shared";
import { useApi } from "./api-context";

export const projectsQueryKey = ["projects"] as const;
export const projectSettingsQueryKey = (projectId: string) => ["project-settings", projectId] as const;

function cacheProjectSettings(queryClient: ReturnType<typeof useQueryClient>, settings: ProjectSettings, previousKey?: string) {
  if (previousKey) queryClient.setQueryData(projectSettingsQueryKey(previousKey), settings);
  queryClient.setQueryData(projectSettingsQueryKey(settings.project.id), settings);
  queryClient.setQueryData(projectSettingsQueryKey(settings.project.slug), settings);
}

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

/** POST /projects/test-connection: verify GitHub repo access before saving. */
export function useTestProjectConnection() {
  const { client } = useApi();
  return useMutation({
    mutationFn: (input: TestConnectionInput) => client.testProjectConnection(input),
  });
}

/** POST /projects: create a new DB-backed Project. */
export function useCreateProject() {
  const { client } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInputRaw) => client.createProject(input),
    onSuccess: (settings) => {
      cacheProjectSettings(queryClient, settings);
      void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
    },
  });
}

/** PATCH /projects/:projectId: update repository, manifest, deploy targets, providers, models, runtime, or secrets. */
export function useUpdateProject(projectId: string) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInputRaw) => client.updateProject(projectId, input),
    onSuccess: (settings) => {
      cacheProjectSettings(queryClient, settings, projectId);
      void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
    },
  });
}

/** POST /projects/:projectId/archive */
export function useArchiveProject(projectId: string) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.archiveProject(projectId),
    onSuccess: (settings) => {
      cacheProjectSettings(queryClient, settings, projectId);
      void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
    },
  });
}

/** POST /projects/:projectId/restore */
export function useRestoreProject(projectId: string) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.restoreProject(projectId),
    onSuccess: (settings) => {
      cacheProjectSettings(queryClient, settings, projectId);
      void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
    },
  });
}

/** DELETE /projects/:projectId: permanently delete a project and its tasks. */
export function useDeleteProject(projectId: string) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.deleteProject(projectId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: projectSettingsQueryKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["project-settings"] });
    },
  });
}

/** PUT /projects/:projectId/secrets/:name */
export function useUpsertProjectSecret(projectId: string) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, input }: { name: string; input: UpsertSecretInput }) =>
      client.upsertProjectSecret(projectId, name, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectSettingsQueryKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: ["project-settings"] });
    },
  });
}

/** DELETE /projects/:projectId/secrets/:name */
export function useDeleteProjectSecret(projectId: string) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => client.deleteProjectSecret(projectId, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectSettingsQueryKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: ["project-settings"] });
    },
  });
}

/** PATCH /projects/:projectId/settings: change the max concurrent Tasks limit. */
export function useUpdateMaxConcurrentTasks(projectId: string) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (limit: number) => client.updateMaxConcurrentTasks(projectId, limit),
    onSuccess: (settings) => {
      cacheProjectSettings(queryClient, settings, projectId);
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
      cacheProjectSettings(queryClient, settings, projectId);
    },
  });
}
