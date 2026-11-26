import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Link, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
import { Archive, ChevronRight, FolderGit2, KanbanSquare, Plus, Settings as SettingsIcon } from "lucide-react";
import type { ProjectSummary } from "@sdlc-ai/shared";
import type { ApiClient } from "~/lib/api";
import { AppHeader } from "~/components/AppHeader";
import { useProjectsQuery } from "~/lib/settings-query";
import { cn } from "~/lib/utils";
import { LAST_PROJECT_STORAGE_KEY } from "./index";
import "../styles.css";

export interface RouterContext {
  queryClient: QueryClient;
  api: ApiClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "AI powered SDLC" },
    ],
  }),
  component: RootComponent,
});

function useActiveProject(projects: readonly ProjectSummary[]): { activeProject: ProjectSummary | null; onSettings: boolean; onTask: boolean; onBoard: boolean } {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const match = pathname.match(/^\/projects\/([^/]+)(\/settings)?\/?$/);
  const rawSlug = match?.[1] ? decodeURIComponent(match[1]) : null;
  const urlSlug = rawSlug && rawSlug !== "new" ? rawSlug : null;
  const onSettings = Boolean(urlSlug && match?.[2]);
  const onTask = pathname.startsWith("/tasks/");
  const onBoard = Boolean(urlSlug && !onSettings);

  const savedSlug = typeof window !== "undefined" ? window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY) : null;
  const activeProject =
    (urlSlug ? projects.find((p) => p.slug === urlSlug) : undefined) ??
    (savedSlug ? projects.find((p) => p.slug === savedSlug && p.archivedAt === null) : undefined) ??
    projects.find((p) => p.archivedAt === null) ??
    null;

  return { activeProject, onSettings, onTask, onBoard };
}

function RootComponent() {
  const projectsQuery = useProjectsQuery();
  const projects = projectsQuery.data ?? [];
  const { activeProject, onSettings, onTask, onBoard } = useActiveProject(projects);

  return (
    <RootDocument>
      <div className="flex min-h-screen bg-background text-foreground">
        <Sidebar projects={projects} activeProject={activeProject} onSettings={onSettings} onTask={onTask} onBoard={onBoard} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader activeProject={activeProject} />
          <main className="min-w-0 flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </RootDocument>
  );
}

function Sidebar({
  projects,
  activeProject,
  onSettings,
  onTask,
  onBoard,
}: {
  projects: readonly ProjectSummary[];
  activeProject: ProjectSummary | null;
  onSettings: boolean;
  onTask: boolean;
  onBoard: boolean;
}) {
  const activeProjects = projects.filter((p) => p.archivedAt === null);
  const archivedProjects = projects.filter((p) => p.archivedAt !== null);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
        <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f6821f] text-sm font-bold text-white">
          S
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-semibold">AI powered SDLC</p>
          <p className="truncate text-[11px] text-muted-foreground">control plane</p>
        </div>
      </div>
      <nav className="flex flex-col gap-4 overflow-auto px-3 py-4 text-[13px]">
        <div>
          <div className="flex items-center justify-between px-2 pb-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">Projects</p>
            <Link
              to="/projects/new"
              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Plus className="h-3 w-3" aria-hidden /> New
            </Link>
          </div>
          {activeProjects.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">No active projects</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {activeProjects.map((p) => {
                const isCurrent = activeProject?.id === p.id;
                return (
                  <Link
                    key={p.id}
                    to={onSettings ? "/projects/$slug/settings" : "/projects/$slug"}
                    params={{ slug: p.slug }}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-secondary/70",
                      isCurrent ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FolderGit2 className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {p.activeTaskCount}/{p.maxConcurrentTasks}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
          {archivedProjects.length > 0 && (
            <details className="group mt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" aria-hidden />
                <Archive className="h-3 w-3" aria-hidden />
                <span>Archived ({archivedProjects.length})</span>
              </summary>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {archivedProjects.map((p) => {
                  const isCurrent = activeProject?.id === p.id;
                  return (
                    <Link
                      key={p.id}
                      to={onSettings ? "/projects/$slug/settings" : "/projects/$slug"}
                      params={{ slug: p.slug }}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 opacity-65 transition-colors hover:bg-secondary/70 hover:opacity-100",
                        isCurrent ? "bg-secondary font-medium text-foreground opacity-100" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <FolderGit2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{p.name}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </details>
          )}
        </div>

        {activeProject && (
          <>
            <div>
              <p className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">Pipeline</p>
              <div className="flex flex-col gap-0.5">
                <Link
                  to="/projects/$slug"
                  params={{ slug: activeProject.slug }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-secondary/70",
                    onBoard ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <KanbanSquare className="h-4 w-4" aria-hidden />
                  Board
                </Link>
                <span
                  className={cn(
                    "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5",
                    onTask ? "bg-secondary font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span className="h-4 w-4" aria-hidden />
                  Task detail
                </span>
              </div>
            </div>
            <div>
              <p className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">Configure</p>
              <div className="flex flex-col gap-0.5">
                <Link
                  to="/projects/$slug/settings"
                  params={{ slug: activeProject.slug }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-secondary/70",
                    onSettings ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <SettingsIcon className="h-4 w-4" aria-hidden />
                  Settings
                </Link>
              </div>
            </div>
          </>
        )}
      </nav>
      <div className="mt-auto border-t border-border px-4 py-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Multi-project · Live over SSE
        </p>
      </div>
    </aside>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
