import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useProjectsQuery } from "~/lib/settings-query";

export const LAST_PROJECT_STORAGE_KEY = "sdlc:lastProjectSlug";

export const Route = createFileRoute("/")({
  component: IndexRedirectPage,
});

function IndexRedirectPage() {
  const navigate = useNavigate();
  const projectsQuery = useProjectsQuery();
  const projects = projectsQuery.data ?? [];

  useEffect(() => {
    if (!projectsQuery.isSuccess || projects.length === 0) return;
    const savedSlug = typeof window !== "undefined" ? window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY) : null;
    const preferred =
      (savedSlug ? projects.find((p) => p.slug === savedSlug && p.active) : undefined) ??
      projects.find((p) => p.active) ??
      projects[0];
    if (preferred) {
      void navigate({ to: "/projects/$slug", params: { slug: preferred.slug }, replace: true });
    }
  }, [navigate, projects, projectsQuery.isSuccess]);

  if (projectsQuery.isPending) {
    return <p className="p-6 text-sm text-muted-foreground">Loading projects…</p>;
  }
  if (projectsQuery.isError) {
    return (
      <p role="alert" className="p-6 text-sm text-red-700">
        Could not load projects: {projectsQuery.error.message}
      </p>
    );
  }
  if (projects.length === 0) {
    return (
      <div className="p-6">
        <div role="alert" className="max-w-xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">No projects configured</p>
          <p className="mt-1 text-amber-800">
            Add at least one entry to <span className="font-mono text-xs">sdlc.config.ts</span> using{" "}
            <span className="font-mono text-xs">defineProjects([...])</span> and restart or reload the API.
          </p>
        </div>
      </div>
    );
  }
  return <p className="p-6 text-sm text-muted-foreground">Opening project board…</p>;
}
