import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Link, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
import { FolderGit2, KanbanSquare, Settings as SettingsIcon } from "lucide-react";
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
  const urlSlug = match?.[1] ? decodeURIComponent(match[1]) : null;
  const onSettings = Boolean(match?.[2]);
  const onTask = pathname.startsWith("/tasks/");
  const onBoard = Boolean(urlSlug && !onSettings);

  const savedSlug = typeof window !== "undefined" ? window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY) : null;
  const activeProject =
    (urlSlug ? projects.find((p) => p.slug === urlSlug) : undefined) ??
    (savedSlug ? projects.find((p) => p.slug === savedSlug && p.active) : undefined) ??
    projects.find((p) => p.active) ??
    projects[0] ??
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
          <p className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">Projects</p>
          {projects.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">No projects</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {projects.map((p) => {
                const isCurrent = activeProject?.id === p.id;
                return (
                  <Link
                    key={p.id}
                    to={onSettings ? "/projects/$slug/settings" : "/projects/$slug"}
                    params={{ slug: p.slug }}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-secondary/70",
                      isCurrent ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                      !p.active && "opacity-60",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FolderGit2 className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {!p.configOk && <span title="Config missing or invalid" className="h-2 w-2 rounded-full bg-amber-500" />}
                      <span className="rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {p.activeTaskCount}/{p.maxConcurrentTasks}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
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
