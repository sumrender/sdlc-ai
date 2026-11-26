import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useProjectsQuery } from "~/lib/settings-query";

export const LAST_PROJECT_STORAGE_KEY = "sdlc:lastProjectSlug";

export const Route = createFileRoute("/")({
  component: IndexRedirectPage,
});

function IndexRedirectPage() {
  const navigate = useNavigate();
  const projectsQuery = useProjectsQuery();
  const projects = projectsQuery.data ?? [];
  const activeProjects = projects.filter((p) => p.archivedAt === null);

  useEffect(() => {
    if (!projectsQuery.isSuccess || activeProjects.length === 0) return;
    const savedSlug = typeof window !== "undefined" ? window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY) : null;
    const preferred =
      (savedSlug ? activeProjects.find((p) => p.slug === savedSlug) : undefined) ??
      activeProjects[0];
    if (preferred) {
      void navigate({ to: "/projects/$slug", params: { slug: preferred.slug }, replace: true });
    }
  }, [navigate, activeProjects, projectsQuery.isSuccess]);

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
  if (activeProjects.length === 0) {
    const archivedCount = projects.length;
    return (
      <div className="p-6">
        <div className="max-w-xl rounded-lg border border-border bg-card p-6">
          <h1 className="text-lg font-semibold tracking-tight">No active projects</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Create your first Project in the UI by connecting a GitHub repository and defining its build, test, and deploy manifest.
            {archivedCount > 0 ? ` You currently have ${archivedCount} archived project(s) in the sidebar.` : ""}
          </p>
          <div className="mt-4">
            <Button asChild size="sm">
              <Link to="/projects/new">
                <Plus /> Create your first Project
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }
  return <p className="p-6 text-sm text-muted-foreground">Opening project board…</p>;
}
