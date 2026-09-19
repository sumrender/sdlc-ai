import { useQuery } from "@tanstack/react-query";
import { useApi } from "./api-context";

export const projectSettingsQueryKey = ["project-settings"] as const;

/** GET /project: the Project, GitHub connection, Deploy Targets, and the Manifest read from the repository. */
export function useProjectSettings() {
  const { client } = useApi();
  return useQuery({ queryKey: projectSettingsQueryKey, queryFn: () => client.getProjectSettings() });
}
